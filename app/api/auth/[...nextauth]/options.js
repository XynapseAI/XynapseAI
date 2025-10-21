// app/api/auth/[...nextauth]/options.js
import { randomBytes } from "crypto";
import GoogleProvider from "@auth/core/providers/google";
import EmailProvider from "@auth/core/providers/email";
import CredentialsProvider from "@auth/core/providers/credentials";
import { SiweMessage } from "siwe";
import { createTransport } from "nodemailer";
import { v4 as uuidv4 } from "uuid";
import { query } from "@/utils/postgres";
import { logger } from "@/utils/serverLogger";
import crypto from 'crypto';
import util from 'util';
import { NeynarAPIClient, Configuration } from "@neynar/nodejs-sdk";  // THAY ĐỔI: Import Configuration cho v2

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

// ================== Email Transporter (giữ nguyên) ==================
const transporter = createTransport({
  host: process.env.EMAIL_SERVER_HOST,
  port: process.env.EMAIL_SERVER_PORT,
  auth: {
    user: process.env.EMAIL_SERVER_USER,
    pass: process.env.EMAIL_SERVER_PASSWORD,
  },
});

// ================== Custom Adapter (giữ nguyên) ==================
const customAdapter = {
  async getUserByEmail(email) {
    logger.info("Fetching user by email", { email });
    const { rows } = await query(
      `SELECT id,email,google_id,google_name,email_verified,profile_picture,
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
  async createUser(data) {
    const id = data.google_id || data.id || uuidv4();
    logger.info("Creating user", { id, email: data.email });

    // Ensure email is not null
    if (!data.email) {
      logger.error("Cannot create user without email", { id });
      throw new Error("Email is required for user creation");
    }

    // Tạo API key và hash
    const plainApiKey = randomBytes(32).toString("hex");
    const { api_key_hash, api_key_salt } = await hashApiKey(plainApiKey);

    const { rows } = await query(
      `INSERT INTO users (
        id,email,google_id,google_name,email_verified,profile_picture,
        connected,last_connected,points,tweet_points,ai_points,task_points,
        is_creator,is_ai_rank,tier,is_plus,is_premium,api_key_hash,api_key_salt,created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
      ON CONFLICT (google_id) DO UPDATE SET
        email=EXCLUDED.email,google_name=EXCLUDED.google_name,email_verified=EXCLUDED.email_verified,
        profile_picture=COALESCE(users.profile_picture, EXCLUDED.profile_picture),connected=EXCLUDED.connected,
        last_connected=EXCLUDED.last_connected,updated_at=CURRENT_TIMESTAMP, api_key_hash=EXCLUDED.api_key_hash, api_key_salt=EXCLUDED.api_key_salt
      RETURNING *`,
      [
        id, data.email, data.google_id || null, data.google_name || null,
        data.email_verified || false, data.profile_picture || null, true,
        new Date(), 0, 0, 0, 0, false, false, "Basic", false, false,
        api_key_hash, api_key_salt, new Date(),
      ]
    );
    logger.info("User created", { id, email: data.email, rowCount: rows.length });
    return { ...rows[0], id: rows[0].id.toString() };
  },
  async updateUser(data) {
    logger.info("Updating user", { id: data.id, email: data.email });
    // Use COALESCE to avoid setting null values for required/important fields
    const { rows } = await query(
      `UPDATE users SET 
        email = COALESCE($2, email),
        google_id = COALESCE($3, google_id),
        google_name = COALESCE($4, google_name),
        email_verified = COALESCE($5, email_verified),
        profile_picture = COALESCE($6, profile_picture),
        connected = $7,
        last_connected = $8,
        updated_at = $9
       WHERE id=$1 RETURNING *`,
      [
        data.id, data.email || null, data.google_id || null, data.google_name || null,
        data.email_verified !== undefined ? data.email_verified : null, data.profile_picture || null,
        data.connected !== undefined ? data.connected : true,
        data.last_connected || new Date(), new Date(),
      ]
    );
    logger.info("User updated", { id: data.id, rowCount: rows.length });
    return { ...rows[0], id: rows[0].id.toString() };
  },
  async createVerificationToken({ identifier, expires, token }) {
    logger.info("Creating verification token", { identifier });
    // Ensure identifier (email) is not null
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
    // Ensure identifier is not null
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
        // Ensure identifier is valid email
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
      id: 'farcaster',
      name: 'Sign in with Farcaster',
      credentials: {
        message: { label: "SIWE Message", type: "text" },
        signature: { label: "Signature", type: "text" },
      },
      async authorize(credentials) {
        try {
          if (!credentials.message || !credentials.signature) {
            logger.error("Missing Farcaster credentials");
            return null;
          }

          const message = new SiweMessage(credentials.message);
          const fields = message.prepareMessage();

          if (fields !== credentials.message) {
            logger.error("Invalid Farcaster message fields");
            return null;
          }

          const valid = await message.verify({ signature: credentials.signature });
          if (!valid) {
            logger.error("Invalid Farcaster signature");
            return null;
          }

          // FIXED: Validate FIP-11 fields (robust chainId comparison)
          if (message.statement !== 'Farcaster Auth') {
            logger.error("Invalid Farcaster statement: expected 'Farcaster Auth'", { statement: message.statement });
            return null;
          }

          // THAY ĐỔI: Chuyển sang Base chainId 8453 (thay vì Optimism 10)
          if (Number(message.chainId) !== 8453) {
            logger.error("Invalid Farcaster chainId: expected 8453 (Base)", {
              chainId: message.chainId,
              type: typeof message.chainId,
              parsed: Number(message.chainId)
            });
            return null;
          }

          const resources = message.resources;
          if (!resources || !Array.isArray(resources) || resources.length === 0) {
            logger.error("No resources in Farcaster message");
            return null;
          }

          // FIXED: Match both spec (fids/) and impl (fid/) formats
          const fidResource = resources.find(r =>
            typeof r === 'string' &&
            (r.startsWith('farcaster://fids/') || r.startsWith('farcaster://fid/'))
          );
          if (!fidResource) {
            logger.error("No FID resource in Farcaster message", { resources });
            return null;
          }

          // FIXED: Regex for both (?:fids|fid)
          const fidMatch = fidResource.match(/farcaster:\/\/(?:fids|fid)\/(\d+)/);
          if (!fidMatch) {
            logger.error("Invalid FID resource format", { fidResource });
            return null;
          }
          const fid = fidMatch[1];

          // THAY ĐỔI: Neynar v2 - Khởi tạo config và client
          const config = new Configuration({
            apiKey: process.env.NEYNAR_API_KEY,
            baseOptions: {
              headers: {
                "x-neynar-experimental": true,
              },
            },
          });
          const client = new NeynarAPIClient(config);

          // THAY ĐỔI: fetchBulkUsers thay vì fetchUser (v2 API)
          let userInfo = { pfp_url: null, display_name: null, username: null };  // FIX: Init với pfp_url
          try {
            const res = await client.fetchBulkUsers({ fids: [parseInt(fid)] });  // Array FID, parseInt cho số
            const fetchedUser = res.users[0];  // Lấy user đầu tiên
            if (fetchedUser) {
              userInfo = {
                pfp_url: fetchedUser.pfp_url || null,  // FIX: Dùng pfp_url trực tiếp (không phải pfp.url)
                display_name: fetchedUser.display_name || null,
                username: fetchedUser.username || null,
              };
              logger.info("Neynar user fetched successfully", { fid, pfp_url: userInfo.pfp_url ? 'present' : 'missing' });  // THÊM: Log để debug
            } else {
              logger.warn("No user found in Neynar response", { fid });
            }
          } catch (neynarErr) {
            logger.warn("Neynar fetch failed (proceeding without profile info)", { fid, error: neynarErr.message });
          }

          const fakeEmail = `${fid}@farcaster.local`;

          const existingUser = await customAdapter.getUserByAccount({ provider: "farcaster", providerAccountId: fid });

          if (existingUser) {
            return existingUser;
          }

          // Tạo user mới
          const newUser = await customAdapter.createUser({
            id: fid,
            email: fakeEmail,
            profile_picture: userInfo.pfp_url || null,  // FIX: Dùng pfp_url thay pfp?.url
            google_name: userInfo.display_name || userInfo.username || null,
            email_verified: true,
          });

          // Link account
          await query(
            `INSERT INTO accounts (userId, type, provider, providerAccountId)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (provider, providerAccountId) DO NOTHING`,
            [newUser.id, 'credentials', 'farcaster', fid]
          );

          logger.info("Farcaster user created/authorized", { fid });
          return newUser;
        } catch (err) {
          logger.error("Farcaster authorize error", { error: err.message });
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      try {
        logger.info("Sign-in attempt", { provider: account.provider, providerId: account.providerId || account.id, email: user.email });  // THÊM: Log account.id cho debug
        let email = user.email || "";
        let googleId = null, googleName = null, profilePic = "", verified = false, userId = null;

        if (!email) {
          logger.error("Sign-in failed: No email provided", { provider: account.provider });
          return false;
        }

        if (account.provider === "google") {
          // ... (giữ nguyên phần Google)
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
          if (existingUser && !existingUser.google_id) {
            logger.warn("Google sign-in denied: Account exists with email only", { email });
            return "This account was registered with email. Please use the old login method (by Email).";
          }

          // Cho Google: Luôn INSERT/UPDATE với ON CONFLICT google_id
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
        }
        // FIX: Đổi account.providerId -> account.provider (Auth.js v5 set provider = id cho credentials)
        else if (account.provider === "farcaster") {
          const fid = user.id; // FID from authorize
          logger.info("Farcaster sign-in successful (DB handled in authorize)", { fid });
          return true; // No redundant updates needed
        }
        else if (account.provider === "email") {
          // ... (giữ nguyên phần Email)
          email = user.email || account.user?.email || "";
          if (!email) {
            logger.error("Email sign-in failed: No email provided", { token: account.token });
            return false;
          }
          verified = true;

          // Check existing user by email
          const existingUser = await customAdapter.getUserByEmail(email);
          if (existingUser) {
            userId = existingUser.id;
            // Update existing user
            await query(
              `UPDATE users SET 
                last_connected = $1, connected = $2, email_verified = $3, updated_at = $4
              WHERE id = $5`,
              [new Date(), true, verified, new Date(), userId]
            );
            logger.info("Existing email user updated", { userId, email });

            // Update API key nếu cần (tùy chọn, vì đã có từ trước)
            const plainApiKey = randomBytes(32).toString("hex");
            const { api_key_hash, api_key_salt } = await hashApiKey(plainApiKey);
            await query(
              `UPDATE users SET api_key_hash = $1, api_key_salt = $2 WHERE id = $3`,
              [api_key_hash, api_key_salt, userId]
            );

            logger.info("Sign-in successful for existing user", { userId, email });
            return true;
          } else {
            // Tạo user mới cho email
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
        }

        logger.error("Sign-in failed: Unsupported provider", { provider: account.provider, providerId: account.providerId || account.id });  // FIX: Log account.id thêm
        return false;
      } catch (err) {
        logger.error("signIn error", { error: err.message, stack: err.stack });
        return false;
      }
    },
    // ... (giữ nguyên jwt, session, redirect)
    async jwt({ token, account, profile }) {
      logger.info("JWT callback", { tokenId: token.id, email: token.email });
      if (account) {
        token.id = account.provider === "google" ? account.providerAccountId : token.sub || uuidv4();
        token.accessToken = account.access_token || randomBytes(32).toString("hex");
        token.expiresAt = Date.now() + 2 * 60 * 60 * 1000; // 2 hours
        token.email = profile?.email || token.email || account.user?.email;
        token.googleName = profile?.name || "";
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