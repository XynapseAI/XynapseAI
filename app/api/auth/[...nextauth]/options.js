import { randomBytes } from "crypto";
import GoogleProvider from "@auth/core/providers/google";
import EmailProvider from "@auth/core/providers/email";
import CredentialsProvider from "@auth/core/providers/credentials"; // Thêm cho Base SIWE
import { createTransport } from "nodemailer";
import { v4 as uuidv4 } from "uuid";
import { query } from "@/utils/postgres";
import { logger } from "@/utils/serverLogger";
import crypto from 'crypto';
import util from 'util';
import { createPublicClient, http } from 'viem'; // Giữ recoverMessageAddress nếu cần EOA
import { base } from 'viem/chains'; // Base chain
import { getRedisClient } from '@/utils/redis';

const scrypt = util.promisify(crypto.scrypt);

// Hàm hashApiKey (giữ nguyên)
async function hashApiKey(apiKey) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await scrypt(apiKey, salt, 64);
  return {
    api_key_hash: derived.toString('hex'),
    api_key_salt: salt,
  };
}

// Verify SIWE cho Base login
const publicClient = createPublicClient({
  chain: base,
  transport: http('https://mainnet.base.org') // Sử dụng RPC chính thức của Base
});

// Verify SIWE cho Base login (tolerant: regex nonce + viem verifyMessage theo Base docs)
async function verifySiwe(credentials) {
  try {
    const { message, signature } = credentials;

    logger.info('Full SIWE input to verify:', {
      message: typeof message === 'string' ? message.substring(0, 300) + (message.length > 300 ? '...' : '') : message,
      signaturePreview: typeof signature === 'string' ? signature.substring(0, 50) + '...' : signature,
      signatureLength: typeof signature === 'string' ? signature.length : 'N/A'
    });

    if (typeof message !== 'string' || typeof signature !== 'string') {
      throw new Error('Message and signature must be strings');
    }

    // 1. Extract Nonce
    const nonceMatch = message.match(/Nonce:\s*([a-f0-9]{32})/i);
    if (!nonceMatch) {
      logger.error('Nonce not found in message via regex', { messagePreview: message.substring(0, 200) });
      throw new Error('Invalid SIWE message: missing nonce');
    }
    const extractedNonce = nonceMatch[1];
    logger.info('Extracted nonce from message:', { nonce: extractedNonce });

    // 2. Extract Chain ID
    if (!message.includes('Chain ID: 8453')) {
      throw new Error('Invalid chain: expected 8453');
    }

    // 3. Extract Domain (bỏ qua check ở dev)
    const domainMatch = message.match(/^([a-zA-Z0-9.-]+):?\d*\s+wants you to sign in/i);
    const extractedDomain = domainMatch ? domainMatch[1] : null;
    logger.info('Extracted domain from message:', { domain: extractedDomain || 'N/A' });

    if (process.env.NODE_ENV !== 'development') {
      const expectedDomain = process.env.APP_DOMAIN || 'xynapseai.net';
      if (extractedDomain !== expectedDomain) {
        throw new Error(`Invalid domain: expected ${expectedDomain}, got ${extractedDomain}`);
      }
    }

    // 4. Extract Address
    const addressMatch = message.match(/Ethereum account:\s*(0x[0-9a-fA-F]{40})/i);
    if (!addressMatch) {
      logger.error('Address not found in message', { messagePreview: message.substring(0, 200) });
      throw new Error('Invalid SIWE message: missing address');
    }
    const extractedAddress = addressMatch[1].toLowerCase();
    logger.info('Extracted address from message:', { address: extractedAddress });

    // 5. Validate Nonce từ Redis
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

    // 6. Consume Nonce
    await client.del(nonceKey);
    logger.info('Nonce consumed (deleted from Redis)');

    logger.info('Nonce validated, proceeding to signature verify');

    // 7. Verify Signature (ĐÃ XÓA BỎ LOGIC EOA THỪA)
    // viem verifyMessage xử lý cả EOA (ecrecover) và Smart Accounts (ERC-1271)
    let valid;
    try {
      valid = await publicClient.verifyMessage({
        address: extractedAddress,
        message,
        signature,
      });
      logger.info('Viem verifyMessage result:', { valid, expectedAddress: extractedAddress });
    } catch (viemError) {
      // Log lỗi chi tiết nếu viem throw
      logger.error('Viem verifyMessage detailed error:', {
        error: viemError.message,
        shortMessage: viemError.shortMessage,
        cause: viemError.cause?.message || 'unknown',
      });
      throw new Error(`Signature verification failed: ${viemError.message}`);
    }

    if (!valid) {
      // Lỗi này có nghĩa là viem đã chạy và trả về false
      throw new Error('Invalid signature (Viem verifyMessage returned false)');
    }

    logger.info('SIWE verified for Base Account', { address: extractedAddress });
    return { address: extractedAddress, message, signature };

  } catch (error) {
    logger.error('SIWE verification failed details:', {
      error: error.message,
      stack: error.stack ? error.stack.substring(0, 200) : 'no stack'
    });
    throw error;  // Re-throw để authorize return null
  }
}

// ================== Email Transporter (giữ nguyên) ==================
const transporter = createTransport({
  host: process.env.EMAIL_SERVER_HOST,
  port: process.env.EMAIL_SERVER_PORT,
  auth: {
    user: process.env.EMAIL_SERVER_USER,
    pass: process.env.EMAIL_SERVER_PASSWORD,
  },
});

// ================== Custom Adapter (giữ nguyên, nhưng thêm wallet_address) ==================
const customAdapter = {
  async getUserByEmail(email) {
    logger.info("Fetching user by email", { email });
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
    const { rows } = await query(
      `SELECT u.* FROM users u
       JOIN accounts a ON u.id=a.userId
       WHERE a.provider=$1 AND a.providerAccountId=$2`,
      [provider, providerAccountId]
    );
    return rows[0] ? { ...rows[0], id: rows[0].id.toString() } : null;
  },
  async getUserByWallet(address) { // Thêm cho Base
    const { rows } = await query(
      `SELECT * FROM users WHERE wallet_address=$1`,
      [address]
    );
    return rows[0] ? { ...rows[0], id: rows[0].id.toString() } : null;
  },
  async createUser(data) {
    const id = data.wallet_address || data.google_id || data.id || uuidv4(); // Ưu tiên wallet_address
    logger.info("Creating user", { id, email: data.email, wallet: data.wallet_address });

    if (!data.email && !data.wallet_address) {
      logger.error("Cannot create user without email or wallet", { id });
      throw new Error("Email or wallet is required");
    }

    const plainApiKey = randomBytes(32).toString("hex");
    const { api_key_hash, api_key_salt } = await hashApiKey(plainApiKey);

    const { rows } = await query(
      `INSERT INTO users (
        id,email,google_id,google_name,email_verified,profile_picture,wallet_address,
        connected,last_connected,points,tweet_points,ai_points,task_points,
        is_creator,is_ai_rank,tier,is_plus,is_premium,api_key_hash,api_key_salt,created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
      ON CONFLICT (wallet_address) DO UPDATE SET  -- Thêm conflict cho wallet
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
  async updateUser(data) {
    logger.info("Updating user", { id: data.id, email: data.email, wallet: data.wallet_address });
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
    // Thêm Credentials cho Base SIWE
    CredentialsProvider({
      name: 'base',
      credentials: {
        message: { label: 'Message', type: 'text' },
        signature: { label: 'Signature', type: 'text' },
      },
      async authorize(credentials) {
        try {
          const { address } = await verifySiwe(credentials);
          // Tìm hoặc tạo user bằng address
          let user = await customAdapter.getUserByWallet(address);
          if (!user) {
            user = await customAdapter.createUser({
              wallet_address: address,
              // Có thể merge với email nếu có từ SIWE statement
            });
            // Tạo account record
            await query(
              `INSERT INTO accounts (userId, type, provider, providerAccountId) VALUES ($1, $2, $3, $4)`,
              [user.id, 'credentials', 'base', address]
            );
          } else {
            // Update last_connected
            await customAdapter.updateUser({ id: user.id, last_connected: new Date() });
          }
          logger.info('Base Account login successful', { address: user.wallet_address });
          return {
            id: user.id || address, // ID là address nếu không có UUID
            email: user.email || `${address}@base.xynapseai.net`, // Fallback email
            name: user.google_name || `Base User ${address.slice(0, 6)}`,
            wallet_address: address,
          };
        } catch (error) {
          logger.error('Base authorize failed', { error: error.message });
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
          // Giữ nguyên logic Google
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

          const result = await query(
            `INSERT INTO users (
              id, email, google_id, google_name, email_verified, profile_picture,
              connected, last_connected, points, tweet_points, ai_points, task_points,
              is_creator, is_ai_rank, tier, is_plus, is_premium, api_key_hash, api_key_salt, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
            ON CONFLICT (google_id) DO UPDATE SET
              email=EXCLUDED.email, google_name=EXCLUDED.google_name, email_verified=EXCLUDED.email_verified, 
              profile_picture=COALESCE(users.profile_picture, EXCLUDED.profile_picture), connected=EXCLUDED.connected,
              last_connected=EXCLUDED.last_connected, updated_at=CURRENT_TIMESTAMP, api_key_hash=EXCLUDED.api_key_hash, api_key_salt=EXCLUDED.api_key_salt`,
            [
              userId, email, googleId, googleName, verified, profilePic, true, new Date(),
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
          // Giữ nguyên logic email
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

            const result = await query(
              `INSERT INTO users (
                id, email, google_id, google_name, email_verified, profile_picture,
                connected, last_connected, points, tweet_points, ai_points, task_points,
                is_creator, is_ai_rank, tier, is_plus, is_premium, api_key_hash, api_key_salt, created_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
              [
                userId, email, null, null, verified, null, true, new Date(),
                0, 0, 0, 0, false, false, "Basic", false, false, api_key_hash, api_key_salt, new Date(),
              ]
            );

            logger.info("New email user created", { userId, email, rowCount: result.rowCount });
            logger.info("Sign-in successful", { userId, email });
            return true;
          }
        } else if (account.provider === "credentials") { // Base login
          // Đã handle ở authorize, chỉ confirm
          logger.info("Base sign-in successful", { wallet: user.wallet_address });
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
        token.walletAddress = user.wallet_address; // Thêm wallet vào token
        token.csrfToken = token.csrfToken || randomBytes(32).toString("hex");
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
      session.user.walletAddress = token.walletAddress; // Thêm wallet vào session
      session.user.isPremium = token.isPremium || false;
      session.csrfToken = token.csrfToken;
      logger.info("Session created", { session: JSON.stringify(session) });
      return session;
    },
    async redirect({ url, baseUrl }) {
      if (url.startsWith('/')) return `${baseUrl}${url}`;
      if (url === baseUrl || url === `${baseUrl}/dashboard`) return url;
      return baseUrl + '/dashboard';
    },
  },
  secret: process.env.AUTH_SECRET,
  session: { strategy: "jwt", maxAge: 2 * 60 * 60 }, // 2 hours
  pages: {
    signIn: "/dashboard",
    error: "/auth/error",
  },
};

export default authOptions;