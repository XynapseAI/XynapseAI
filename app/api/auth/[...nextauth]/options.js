import { randomBytes } from "crypto";
import GoogleProvider from "@auth/core/providers/google";
import EmailProvider from "@auth/core/providers/email";
import CredentialsProvider from "@auth/core/providers/credentials";
import { createTransport } from "nodemailer";
import { v4 as uuidv4 } from "uuid";
import { query } from "@/utils/postgres";
import { logger } from "@/utils/serverLogger";
import crypto from 'crypto';
import util from 'util';
import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains'; // Base chain
import { getRedisClient } from '@/utils/redis';
import { SiweMessage } from 'siwe'; // Standard SIWE parser (npm install siwe)
import { createClient as createQuickAuthClient, Errors } from '@farcaster/quick-auth'; // NEW: For Farcaster Quick Auth verification
const scrypt = util.promisify(crypto.scrypt);
async function hashApiKey(apiKey) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await scrypt(apiKey, salt, 64);
  return {
    api_key_hash: derived.toString('hex'),
    api_key_salt: salt,
  };
}
const publicClient = createPublicClient({
  chain: base,
  transport: http('https://mainnet.base.org')
});
// IMPROVED: Verify SIWE with siwe parser (replaces regex) + viem verify (for ERC-6492)
async function verifySiwe(credentials) {
  try {
    const { message, signature } = credentials;
    logger.info('Full SIWE input to verify:', {
      message: typeof message === 'string' ? message.substring(0, 300) + (message.length > 300 ? '...' : '') : message,
      fullMessageLength: typeof message === 'string' ? message.length : 'N/A',
      signaturePreview: typeof signature === 'string' ? signature.substring(0, 50) + '...' : signature,
      signatureLength: typeof signature === 'string' ? signature.length : 'N/A',
      messageType: typeof message,
      signatureType: typeof signature,
    });
    if (typeof message !== 'string' || typeof signature !== 'string') {
      throw new Error('Message and signature must be strings');
    }
    // Ensure signature is 0x-prefixed (common issue with some SDKs)
    let sig = signature;
    if (!sig.startsWith('0x')) {
      sig = '0x' + sig;
      logger.info('Added 0x prefix to signature');
    }
    // Try siwe parse first
    let siweMessage, extractedAddress, extractedNonce, extractedDomain, extractedChainId;
    let isPartial = false;
    try {
      siweMessage = new SiweMessage(message);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { address, domain, chainId, nonce, issuedAt, version, uri, statement, resources } = siweMessage;
      logger.info('Parsed SIWE fields:', {
        address: address?.toLowerCase(),
        domain,
        chainId,
        nonce,
        version,
        issuedAt: issuedAt?.toISOString(),
        uri,
        resources: resources?.length || 0
      });
      // Strict validation
      if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
        throw new Error('Invalid address in SIWE message');
      }
      if (version !== '1') {
        throw new Error('Invalid SIWE version: must be 1');
      }
      if (chainId !== '8453') { // Base mainnet
        throw new Error('Invalid chain: expected 8453 (Base)');
      }
      if (!domain || (process.env.NODE_ENV !== 'development' && domain !== (process.env.APP_DOMAIN || 'xynapseai.net'))) {
        throw new Error(`Invalid domain: expected ${process.env.APP_DOMAIN || 'xynapseai.net'}, got ${domain}`);
      }
      if (!uri || !uri.startsWith('http')) {
        throw new Error('Invalid URI in SIWE message');
      }
      if (issuedAt) {
        const issuedDate = new Date(issuedAt);
        const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
        if (issuedDate < fiveMinAgo) {
          throw new Error('SIWE message issued too long ago (must be within 5 minutes)');
        }
      } else {
        throw new Error('Missing issuedAt in SIWE message');
      }
      if (resources && resources.length > 0) {
        // Optional: Allow empty resources, but log if present
        logger.warn('SIWE message has resources – verify if expected', { resources });
      }
      // Use parsed values
      extractedAddress = address.toLowerCase();
      extractedNonce = nonce;
      extractedDomain = domain;
      extractedChainId = chainId.toString();
      logger.info('Extracted from SIWE parser:', { address: extractedAddress, nonce: extractedNonce });
    } catch (parseErr) {
      logger.warn('Siwe parse failed (possible partial from SDK), fallback regex:', { error: parseErr.message });
      isPartial = true;
      // Fallback improved regex for partial messages
      const domainMatch = message.match(/^([a-zA-Z0-9.-]+):?\d*\s+wants you to sign in/i);
      extractedDomain = domainMatch ? domainMatch[1] : null;
      const addressMatch = message.match(/0x[a-fA-F0-9]{40}/i);
      extractedAddress = addressMatch ? addressMatch[0].toLowerCase() : null;
      const chainMatch = message.match(/Chain ID:\s*(\d+)/i);
      extractedChainId = chainMatch ? chainMatch[1] : null;
      const nonceMatch = message.match(/Nonce:\s*([a-f0-9]{32})/i);
      extractedNonce = nonceMatch ? nonceMatch[1] : null;
      // Strict: Reject if missing Version or Issued At (EIP-4361 required)
      const hasVersion = message.includes('Version: 1');
      const hasIssuedAt = message.includes('Issued At:');
      if (!hasVersion || !hasIssuedAt) {
        throw new Error('Invalid SIWE: missing Version or Issued At (required per EIP-4361)');
      }
      if (!extractedAddress || !extractedNonce || !extractedDomain || extractedChainId !== '8453') {
        throw new Error('Fallback extract failed: missing core fields');
      }
      logger.info('Extracted from fallback regex:', { address: extractedAddress, nonce: extractedNonce });
    }
    // Check nonce in Redis (use extractedNonce)
    const client = await getRedisClient();
    const nonceKey = `siwe:nonce:${extractedNonce}`;
    logger.info('Redis nonce lookup attempt:', { nonceKey });
    const storedData = await client.get(nonceKey);
    logger.info('Redis nonce lookup result:', { hasData: !!storedData });
    if (!storedData) {
      throw new Error(`Nonce not found in Redis or already used`);
    }
    let parsedStored;
    try {
      parsedStored = JSON.parse(storedData);
    } catch (parseErr) {
      logger.error('JSON parse error on stored data:', { error: parseErr.message, rawData: storedData });
      throw new Error(`Invalid stored nonce data: ${parseErr.message}`);
    }
    const { expires } = parsedStored;
    const now = Date.now();
    const expiresDate = new Date(expires);
    const nowDate = new Date(now);
    const isExpired = nowDate > expiresDate;
    logger.info('Nonce expiration check:', { isExpired });
    if (isExpired) {
      await client.del(nonceKey); // Cleanup expired
      throw new Error(`Nonce expired`);
    }
    // Cross-check issuedAt vs nonce creation (approx)
    const ttlMs = process.env.NODE_ENV === 'development' ? 600000 : 300000;
    const nonceCreationApprox = expires - ttlMs;
    const issuedTimeMs = new Date(message.match(/Issued At:\s*(.+)/i)?.[1] || now).getTime();
    if (Math.abs(issuedTimeMs - nonceCreationApprox) > 5 * 60 * 1000) {
      throw new Error('SIWE issuedAt does not match nonce freshness');
    }
    // Consume Nonce
    await client.del(nonceKey);
    logger.info('Nonce consumed (deleted from Redis)');
    logger.info('SIWE parsed & nonce validated, proceeding to signature verify');
    // Verify Signature (viem – handles ERC-6492 for pre-deploy)
    let valid;
    try {
      valid = await publicClient.verifyMessage({
        address: extractedAddress,
        message,
        signature: sig,
      });
      logger.info('Viem verifyMessage result:', { valid, expectedAddress: extractedAddress, messageLength: message.length });
    } catch (viemError) {
      logger.error('Viem verifyMessage detailed error:', {
        error: viemError.message,
        shortMessage: viemError.shortMessage,
        cause: viemError.cause?.message || 'unknown',
      });
      throw new Error(`Signature verification failed: ${viemError.message}`);
    }
    if (!valid) {
      logger.error('Viem verifyMessage returned false', {
        messagePreview: message.substring(0, 200),
        sigLength: sig.length,
      });
      throw new Error('Invalid signature (Viem verifyMessage returned false)');
    }
    logger.info(`SIWE fully verified for Base Account (siwe${isPartial ? '+fallback' : ''})`, { address: extractedAddress });
    return { address: extractedAddress, message, signature };
  } catch (error) {
    logger.error('SIWE verification failed details:', {
      error: error.message,
      stack: error.stack ? error.stack.substring(0, 200) : 'no stack'
    });
    throw error;
  }
}
// NEW: Verify Farcaster Quick Auth JWT
async function verifyFarcasterJwt(credentials, req) {
  try {
    const { token } = credentials;
    if (!token) throw new Error('Missing token in credentials');
    const quickAuthClient = createQuickAuthClient();
    // Decode token to log aud for debug
    const decoded = JSON.parse(atob(token.split('.')[1]));
    logger.info('Decoded token for verification:', {
      sub: decoded.sub, // FID
      aud: decoded.aud, // Key: Check this!
      exp: new Date(decoded.exp * 1000).toISOString(),
    });
    // Domains to try: always test both
    const domainsToTry = ['base.xynapseai.net', 'xynapseai.net'];
    let payload;
    let verifiedDomain;
    for (const tryDomain of domainsToTry) {
      try {
        payload = await quickAuthClient.verifyJwt({ token, domain: tryDomain });
        verifiedDomain = tryDomain;
        logger.info('Verify success with domain:', { domain: tryDomain, fid: payload.sub });
        break;
      } catch (err) {
        logger.warn('Verify failed with domain:', { domain: tryDomain, error: err.message });
      }
    }
    if (!payload) {
      throw new Error('Verification failed with all domains');
    }
    if (!payload?.sub) {
      throw new Error('Invalid payload: No FID (sub)');
    }
    // Skip aud check since we tried multiple
    return { fid: parseInt(payload.sub, 10) };
  } catch (error) {
    logger.error('Full Farcaster verify error:', {
      error: error.message,
      isInvalidToken: error instanceof Errors.InvalidTokenError,
      stack: error.stack?.substring(0, 200)
    });
    throw error;
  }
}

// ================== Email Transporter ==================
const transporter = createTransport({
  host: process.env.EMAIL_SERVER_HOST,
  port: process.env.EMAIL_SERVER_PORT,
  auth: {
    user: process.env.EMAIL_SERVER_USER,
    pass: process.env.EMAIL_SERVER_PASSWORD,
  },
});
// ================== Custom Adapter ==================
// FIXED: Backward-compatible queries without farcaster_fid in general SELECTs (add column via migration for Farcaster support)
const customAdapter = {
  async getUserByEmail(email) {
    logger.info("Fetching user by email", { email });
    // FIXED: Exclude farcaster_fid to avoid column error if not added yet
    const { rows } = await query(
      `SELECT id,email,google_id,google_name,email_verified,profile_picture,wallet_address,
              connected,last_connected,points,tweet_points,ai_points,task_points,
              is_creator,is_ai_rank,tier,is_plus,is_premium,api_key_hash,api_key_salt,created_at
       FROM users WHERE email=$1`,
      [email]
    );
    return rows[0] ? { ...rows[0], id: rows[0].id.toString() } : null;
  },
  async getUserByAccount({ provider, providerAccountId }) {
    logger.info("Fetching user by account", { provider, providerAccountId });
    // FIXED: Specify fields without farcaster_fid
    const { rows } = await query(
      `SELECT u.id,u.email,u.google_id,u.google_name,u.email_verified,u.profile_picture,u.wallet_address,
              u.connected,u.last_connected,u.points,u.tweet_points,u.ai_points,u.task_points,
              u.is_creator,u.is_ai_rank,u.tier,u.is_plus,u.is_premium,u.api_key_hash,u.api_key_salt,u.created_at
       FROM users u
       JOIN accounts a ON u.id=a.userId
       WHERE a.provider=$1 AND a.providerAccountId=$2`,
      [provider, providerAccountId]
    );
    return rows[0] ? { ...rows[0], id: rows[0].id.toString() } : null;
  },
  async getUserByWallet(address) {
    // FIXED: Specify fields without farcaster_fid
    const { rows } = await query(
      `SELECT id,email,google_id,google_name,email_verified,profile_picture,wallet_address,
              connected,last_connected,points,tweet_points,ai_points,task_points,
              is_creator,is_ai_rank,tier,is_plus,is_premium,api_key_hash,api_key_salt,created_at
       FROM users WHERE wallet_address=$1`,
      [address]
    );
    return rows[0] ? { ...rows[0], id: rows[0].id.toString() } : null;
  },
  // NEW: Get user by Farcaster FID (requires column addition: ALTER TABLE users ADD COLUMN farcaster_fid BIGINT;)
  async getUserByFid(fid) {
    try {
      const { rows } = await query(
        `SELECT * FROM users WHERE farcaster_fid=$1`,
        [fid]
      );
      return rows[0] ? { ...rows[0], id: rows[0].id.toString() } : null;
    } catch (err) {
      if (err.message.includes('column "farcaster_fid" does not exist')) {
        logger.warn('farcaster_fid column missing; run migration to add it for Farcaster support');
        return null;
      }
      throw err;
    }
  },
  async createUser(data) {
    const id = data.wallet_address || data.google_id || data.id || uuidv4();
    logger.info("Creating user", { id, email: data.email, wallet: data.wallet_address });
    if (!data.email && !data.wallet_address) {
      logger.error("Cannot create user without email or wallet", { id });
      throw new Error("Email or wallet is required");
    }
    const plainApiKey = randomBytes(32).toString("hex");
    const { api_key_hash, api_key_salt } = await hashApiKey(plainApiKey);
    logger.info('Executing user insert', { id, wallet: data.wallet_address });
    // FIXED: General INSERT without farcaster_fid (add via separate for Farcaster)
    const { rows } = await query(
      `INSERT INTO users (
        id,email,google_id,google_name,email_verified,profile_picture,wallet_address,
        connected,last_connected,points,tweet_points,ai_points,task_points,
        is_creator,is_ai_rank,tier,is_plus,is_premium,api_key_hash,api_key_salt,created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
      ON CONFLICT (wallet_address) DO UPDATE SET
        email=COALESCE(EXCLUDED.email, users.email),google_name=EXCLUDED.google_name,email_verified=EXCLUDED.email_verified,
        profile_picture=COALESCE(users.profile_picture, EXCLUDED.profile_picture),connected=EXCLUDED.connected,
        last_connected=EXCLUDED.last_connected,updated_at=CURRENT_TIMESTAMP, api_key_hash=EXCLUDED.api_key_hash, api_key_salt=EXCLUDED.api_key_salt
      RETURNING *`,
      [
        id, data.email || null, data.google_id || null, data.google_name || null,
        data.email_verified || false, data.profile_picture || null, data.wallet_address || null, true,
        new Date(), 0, 0, 0, 0, false, false, "Basic", false, false,
        api_key_hash, api_key_salt, new Date(),
      ]
    );
    logger.info("User created", { id, email: data.email, wallet: data.wallet_address, rowCount: rows.length });
    return { ...rows[0], id: rows[0].id.toString() };
  },
  // NEW: Create/update for Farcaster (assumes column exists)
  async createFarcasterUser(fid, fallbackEmail) {
    const id = uuidv4();
    const plainApiKey = randomBytes(32).toString("hex");
    const { api_key_hash, api_key_salt } = await hashApiKey(plainApiKey);
    try {
      const { rows } = await query(
        `INSERT INTO users (
          id,email,farcaster_fid,google_name,email_verified,profile_picture,wallet_address,
          connected,last_connected,points,tweet_points,ai_points,task_points,
          is_creator,is_ai_rank,tier,is_plus,is_premium,api_key_hash,api_key_salt,created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
        ON CONFLICT (farcaster_fid) DO UPDATE SET
          email=COALESCE(EXCLUDED.email, users.email),google_name=EXCLUDED.google_name,email_verified=EXCLUDED.email_verified,
          profile_picture=COALESCE(users.profile_picture, EXCLUDED.profile_picture),connected=EXCLUDED.connected,
          last_connected=EXCLUDED.last_connected,updated_at=CURRENT_TIMESTAMP, api_key_hash=EXCLUDED.api_key_hash, api_key_salt=EXCLUDED.api_key_salt
        RETURNING *`,
        [
          id, fallbackEmail, fid, `Farcaster User #${fid}`, true, null, null, true,
          new Date(), 0, 0, 0, 0, false, false, "Basic", false, false,
          api_key_hash, api_key_salt, new Date(),
        ]
      );
      logger.info("Farcaster user created/updated", { id, fid, rowCount: rows.length });
      return { ...rows[0], id: rows[0].id.toString() };
    } catch (err) {
      if (err.message.includes('column "farcaster_fid" does not exist')) {
        logger.error('farcaster_fid column missing; run: ALTER TABLE users ADD COLUMN farcaster_fid BIGINT;');
        throw new Error('Database migration needed for Farcaster support');
      }
      throw err;
    }
  },
  async updateUser(data) {
    logger.info("Updating user", { id: data.id, email: data.email, wallet: data.wallet_address });
    // FIXED: General UPDATE without farcaster_fid
    const { rows } = await query(
      `UPDATE users SET
        email = COALESCE($2, email),
        google_id = COALESCE($3, google_id),
        google_name = COALESCE($4, google_name),
        email_verified = COALESCE($5, email_verified),
        profile_picture = COALESCE($6, profile_picture),
        wallet_address = COALESCE($7, wallet_address),
        connected = $8,
        last_connected = $9,
        updated_at = $10
       WHERE id=$1 RETURNING *`,
      [
        data.id, data.email || null, data.google_id || null, data.google_name || null,
        data.email_verified !== undefined ? data.email_verified : null, data.profile_picture || null,
        data.wallet_address || null, data.connected !== undefined ? data.connected : true,
        data.last_connected || new Date(), new Date(),
      ]
    );
    logger.info("User updated", { id: data.id, rowCount: rows.length });
    return { ...rows[0], id: rows[0].id.toString() };
  },
  // NEW: Update for Farcaster
  async updateFarcasterUser(id, lastConnected) {
    try {
      await query(
        `UPDATE users SET
          last_connected = $1,
          connected = $2,
          updated_at = $3
         WHERE id=$4`,
        [lastConnected, true, new Date(), id]
      );
      logger.info("Farcaster user updated", { id });
    } catch (err) {
      if (err.message.includes('column "farcaster_fid" does not exist')) {
        logger.error('farcaster_fid column missing; run migration');
        throw new Error('Database migration needed');
      }
      throw err;
    }
  },
  async createVerificationToken({ identifier, expires, token }) {
    logger.info("Creating verification token", { identifier });
    if (!identifier) {
      logger.error("Cannot create verification token without identifier");
      throw new Error("Identifier is required for verification token");
    }
    const { rows } = await query(
      `INSERT INTO verification_tokens (identifier,token,expires)
       VALUES ($1,$2,$3) RETURNING *`,
      [identifier, token, expires]
    );
    return rows[0];
  },
  async useVerificationToken({ identifier, token }) {
    logger.info("Using verification token", { identifier });
    if (!identifier) {
      logger.error("Cannot use verification token without identifier");
      return null;
    }
    const { rows } = await query(
      `DELETE FROM verification_tokens WHERE identifier=$1 AND token=$2 RETURNING *`,
      [identifier, token]
    );
    return rows[0] || null;
  },
};
const isProd = process.env.NODE_ENV === 'production';
const cookieDomain = isProd ? '.xynapseai.net' : undefined; // Dev: undefined (default localhost), Prod: share subdomain
// ================== Auth Options ==================
export const authOptions = {
  adapter: customAdapter,
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: {
        params: {
          prompt: "consent",
          access_type: "offline",
          response_type: "code",
        },
      },
    }),
    EmailProvider({
      server: {
        host: process.env.EMAIL_SERVER_HOST,
        port: process.env.EMAIL_SERVER_PORT,
        auth: {
          user: process.env.EMAIL_SERVER_USER,
          pass: process.env.EMAIL_SERVER_PASSWORD,
        },
      },
      from: process.env.EMAIL_FROM,
      sendVerificationRequest: async ({ identifier, url, provider }) => {
        logger.info("Sending email verification", { identifier, url });
        if (!identifier || !identifier.includes('@')) {
          logger.error("Invalid email identifier for verification", { identifier });
          throw new Error("Invalid email address");
        }
        await transporter.sendMail({
          to: identifier,
          from: provider.from,
          subject: "Welcome to XynapseAI! Confirm Login",
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <h1 style="color: #4285f4; text-align: center;">Welcome to XynapseAI !</h1>
              <p>Hello,</p>
              <p>You have requested to log in to your Xynapse account using this email address.</p>
              <p>To complete your login, click the button below:</p>
              <div style="text-align: center; margin: 20px 0;">
                <a href="${url}" style="background: #4285f4; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">Login now</a>
              </p>
              <p>If you do not require this login, please ignore this email.</p>
              <p style="font-size: 12px; color: #666;">This link will expire after 24 hours.</p>
              <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
              <p style="font-size: 12px; color: #666; text-align: center;">Thank you!</p>
            </div>
          `,
        });
      },
    }),
    CredentialsProvider({
      name: 'base',
      credentials: {
        message: { label: 'Message', type: 'text' },
        signature: { label: 'Signature', type: 'text' },
      },
      async authorize(credentials) {
        try {
          const { address } = await verifySiwe(credentials);
          let user = await customAdapter.getUserByWallet(address);
          if (!user) {
            const fallbackEmail = `${address.toLowerCase()}@base.xynapseai.net`;
            user = await customAdapter.createUser({
              wallet_address: address,
              email: fallbackEmail,
              email_verified: true, // Verified qua SIWE signature
            });
            await query(
              `INSERT INTO accounts (userId, type, provider, providerAccountId) VALUES ($1, $2, $3, $4)`,
              [user.id, 'credentials', 'base', address]
            );
          } else {
            // Update last_connected
            await customAdapter.updateUser({ id: user.id, last_connected: new Date() });
          }
          logger.info('Base Account login successful', { address: user.wallet_address, email: user.email });
          return {
            id: user.id || address,
            email: user.email,
            name: user.google_name || `Base User ${address.slice(0, 6)}`,
            wallet_address: address,
          };
        } catch (error) {
          logger.error('Base authorize failed', { error: error.message });
          return null;
        }
      },
    }),
    // NEW: Farcaster Provider using Quick Auth JWT
    CredentialsProvider({
      name: 'farcaster',
      credentials: {
        token: { label: 'Token', type: 'text' },
      },
      async authorize(credentials, req) {
        try {
          const { fid } = await verifyFarcasterJwt(credentials, req);
          let user = await customAdapter.getUserByFid(fid);
          if (!user) {
            const fallbackEmail = `fid${fid}@farcaster.xynapseai.net`;
            user = await customAdapter.createFarcasterUser(fid, fallbackEmail);
            await query(
              `INSERT INTO accounts (userId, type, provider, providerAccountId) VALUES ($1, $2, $3, $4)`,
              [user.id, 'credentials', 'farcaster', fid.toString()]
            );
          } else {
            // Update last_connected
            await customAdapter.updateFarcasterUser(user.id, new Date());
          }
          logger.info('Farcaster login successful', { fid: user.farcaster_fid, email: user.email });
          return {
            id: user.id || fid.toString(),
            email: user.email,
            name: user.google_name || `Farcaster User #${fid}`,
            farcaster_fid: fid,
          };
        } catch (error) {
          logger.error('Farcaster authorize failed', { error: error.message });
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      try {
        logger.info("Sign-in attempt", { provider: account.provider, email: user.email, wallet: user.wallet_address });
        let email = user.email || "";
        let googleId = null, googleName = null, profilePic = "", verified = false, userId = null;
        if (!email && !user.wallet_address) {
          logger.error("Sign-in failed: No email or wallet provided", { provider: account.provider });
          return false;
        }
        if (account.provider === "google") {
          email = profile.email || user.email || "";
          if (!email) {
            logger.error("Google sign-in failed: No email in profile", { providerAccountId: profile.sub });
            return false;
          }
          profilePic = profile.picture || "";
          googleId = profile.sub;
          googleName = profile.name;
          verified = profile.email_verified || false;
          userId = googleId;
          const existingUser = await customAdapter.getUserByEmail(email);
          if (existingUser && !existingUser.google_id && !existingUser.wallet_address) {
            logger.warn("Google sign-in denied: Account exists with email only", { email });
            return "This account was registered with email. Please use the old login method (by Email).";
          }
          const plainApiKey = randomBytes(32).toString("hex");
          const { api_key_hash, api_key_salt } = await hashApiKey(plainApiKey);
          // FIXED: Google-specific INSERT without farcaster_fid
          const result = await query(
            `INSERT INTO users (
              id, email, google_id, google_name, email_verified, profile_picture, wallet_address,
              connected, last_connected, points, tweet_points, ai_points, task_points,
              is_creator, is_ai_rank, tier, is_plus, is_premium, api_key_hash, api_key_salt, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
            ON CONFLICT (google_id) DO UPDATE SET
              email=EXCLUDED.email, google_name=EXCLUDED.google_name, email_verified=EXCLUDED.email_verified,
              profile_picture=COALESCE(users.profile_picture, EXCLUDED.profile_picture),
              wallet_address=COALESCE(users.wallet_address, EXCLUDED.wallet_address),
              connected=EXCLUDED.connected,
              last_connected=EXCLUDED.last_connected, updated_at=CURRENT_TIMESTAMP,
              api_key_hash=EXCLUDED.api_key_hash, api_key_salt=EXCLUDED.api_key_salt`,
            [
              userId, email, googleId, googleName, verified, profilePic, null, true, new Date(),
              0, 0, 0, 0, false, false, "Basic", false, false, api_key_hash, api_key_salt, new Date(),
            ]
          );
          logger.info("Google user insert/update result", { userId, email, rowCount: result.rowCount });
          await query(
            `INSERT INTO accounts (userId, type, provider, providerAccountId, access_token, expires_at, token_type, scope, id_token)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (provider, providerAccountId) DO UPDATE SET
               access_token = $5, expires_at = $6, token_type = $7, scope = $8, id_token = $9`,
            [
              userId, account.type, account.provider, account.providerAccountId,
              account.access_token, account.expires_at ? account.expires_at : null,
              account.token_type, account.scope, account.id_token,
            ]
          );
          logger.info("Sign-in successful", { userId, email });
          return true;
        } else if (account.provider === "email") {
          email = user.email || account.user?.email || "";
          if (!email) {
            logger.error("Email sign-in failed: No email provided", { token: account.token });
            return false;
          }
          verified = true;
          const existingUser = await customAdapter.getUserByEmail(email);
          if (existingUser) {
            userId = existingUser.id;
            await query(
              `UPDATE users SET
                last_connected = $1, connected = $2, email_verified = $3, updated_at = $4
              WHERE id = $5`,
              [new Date(), true, verified, new Date(), userId]
            );
            logger.info("Existing email user updated", { userId, email });
            const plainApiKey = randomBytes(32).toString("hex");
            const { api_key_hash, api_key_salt } = await hashApiKey(plainApiKey);
            await query(
              `UPDATE users SET api_key_hash = $1, api_key_salt = $2 WHERE id = $3`,
              [api_key_hash, api_key_salt, userId]
            );
            logger.info("Sign-in successful for existing user", { userId, email });
            return true;
          } else {
            userId = uuidv4();
            const plainApiKey = randomBytes(32).toString("hex");
            const { api_key_hash, api_key_salt } = await hashApiKey(plainApiKey);
            // FIXED: Email-specific INSERT without farcaster_fid
            const result = await query(
              `INSERT INTO users (
                id, email, google_id, google_name, email_verified, profile_picture, wallet_address,
                connected, last_connected, points, tweet_points, ai_points, task_points,
                is_creator, is_ai_rank, tier, is_plus, is_premium, api_key_hash, api_key_salt, created_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
              [
                userId, email, null, null, verified, null, null, true, new Date(),
                0, 0, 0, 0, false, false, "Basic", false, false, api_key_hash, api_key_salt, new Date(),
              ]
            );
            logger.info("New email user created", { userId, email, rowCount: result.rowCount });
            logger.info("Sign-in successful", { userId, email });
            return true;
          }
        } else if (account.provider === "credentials") { // Base login
          logger.info("Base sign-in successful", { wallet: user.wallet_address });
          return true;
        } else if (account.provider === "farcaster") { // NEW: Farcaster login
          logger.info("Farcaster sign-in successful", { fid: user.farcaster_fid });
          return true;
        }
        logger.error("Sign-in failed: Unsupported provider", { provider: account.provider });
        return false;
      } catch (err) {
        logger.error("signIn error", { error: err.message, stack: err.stack });
        return false;
      }
    },
    async jwt({ token, account, profile, user }) {
      logger.info("JWT callback", { tokenId: token.id, email: token.email });
      if (account && user) {
        token.id = user.wallet_address || account.providerAccountId || token.sub || uuidv4();
        token.accessToken = account.access_token || randomBytes(32).toString("hex");
        token.expiresAt = Date.now() + 2 * 60 * 60 * 1000; // 2 hours
        token.email = user.email || token.email || account.user?.email;
        token.googleName = user.name || profile?.name || "";
        token.walletAddress = user.wallet_address;
        token.csrfToken = token.csrfToken || randomBytes(32).toString("hex");
        // NEW: Add farcaster_fid if present
        if (user.farcaster_fid) {
          token.farcasterFid = user.farcaster_fid;
        }
      }
      if (Date.now() > token.expiresAt) {
        logger.info("Token expired, refreshing", { tokenId: token.id });
        token.accessToken = randomBytes(32).toString("hex");
        token.expiresAt = Date.now() + 2 * 60 * 60 * 1000;
        token.csrfToken = randomBytes(32).toString("hex");
      }
      logger.info("JWT token", { token: JSON.stringify(token) });
      return token;
    },
    async session({ session, token }) {
      logger.info("Session callback", { userId: token.id });
      if (!token.id) {
        logger.error("Token missing id", { token: JSON.stringify(token) });
        throw new Error("Invalid token: missing id");
      }
      session.user = session.user || {};
      session.user.id = token.id;
      session.user.email = token.email;
      session.user.googleName = token.googleName;
      session.user.walletAddress = token.walletAddress;
      // NEW: Add farcaster_fid if present
      if (token.farcasterFid) {
        session.user.farcasterFid = token.farcasterFid;
      }
      session.user.isPremium = token.isPremium || false;
      session.csrfToken = token.csrfToken;
      logger.info("Session created", { session: JSON.stringify(session) });
      return session;
    },
    // FIXED: Prioritize original url if it's on subdomain, fallback to baseUrl
    async redirect({ url, baseUrl }) {
      // Nếu url là absolute và match domain của bạn, giữ nguyên
      if (url.startsWith('https://') && (url.includes('xynapseai.net') || url.includes('base.xynapseai.net'))) {
        return url;
      }
      // Fallback relative đến dashboard trên domain hiện tại (dùng baseUrl động)
      return new URL('/dashboard', baseUrl).toString();
    },
  },
  ...(isProd && {
    cookies: {
      sessionToken: {
        name: 'next-auth.session-token',
        options: {
          httpOnly: false,
          sameSite: 'lax', // Changed back to 'none' for cross-site compatibility (e.g., mobile WebView)
          path: '/',
          secure: true,
          domain: cookieDomain,
        },
      },
      callbackUrl: {
        name: 'next-auth.callback-url',
        options: {
          httpOnly: false,
          sameSite: 'lax',
          path: '/',
          secure: true,
          domain: cookieDomain,
        },
      },
      csrfToken: {
        name: 'next-auth.csrf-token',
        options: {
          httpOnly: false,
          sameSite: 'lax',
          path: '/',
          secure: true,
          domain: process.env.COOKIE_DOMAIN || '.xynapseai.net',
        },
      },
    },
  }),
  secret: process.env.AUTH_SECRET,
  session: { strategy: "jwt", maxAge: 2 * 60 * 60 }, // 2 hours
  pages: {
    signIn: "/dashboard",
    error: "/auth/error",
  },
};
export default authOptions;