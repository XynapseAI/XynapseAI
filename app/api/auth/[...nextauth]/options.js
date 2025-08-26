import { randomBytes } from "crypto";
import GoogleProvider from "@auth/core/providers/google";
import EmailProvider from "@auth/core/providers/email";
import { createTransport } from "nodemailer";
import { v4 as uuidv4 } from "uuid";
import { query } from "@/utils/postgres";
import { logger } from "@/utils/serverLogger";

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
const customAdapter = {
  async getUserByEmail(email) {
    logger.info("Fetching user by email", { email });
    const { rows } = await query(
      `SELECT id,email,google_id,google_name,email_verified,profile_picture,
              connected,last_connected,points,tweet_points,ai_points,task_points,
              is_creator,is_ai_rank,tier,is_plus,is_premium,api_key,created_at
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
    const { rows } = await query(
      `INSERT INTO users (id,email,google_id,google_name,email_verified,profile_picture,
         connected,last_connected,points,tweet_points,ai_points,task_points,is_creator,
         is_ai_rank,tier,is_plus,is_premium,api_key,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       ON CONFLICT (google_id) DO UPDATE SET
         email=$2,google_name=$4,email_verified=$5,profile_picture=$6,connected=$7,
         last_connected=$8,updated_at=$19
       RETURNING *`,
      [
        id, data.email, data.google_id || null, data.google_name || null,
        data.email_verified || false, data.profile_picture || null, true,
        new Date(), 0, 0, 0, 0, false, false, "Basic", false, false,
        randomBytes(32).toString("hex"), new Date(),
      ]
    );
    logger.info("User created", { id, email: data.email, rowCount: rows.length });
    return { ...rows[0], id: rows[0].id.toString() };
  },
  async updateUser(data) {
    logger.info("Updating user", { id: data.id });
    const { rows } = await query(
      `UPDATE users SET email=$2,google_id=$3,google_name=$4,email_verified=$5,
         profile_picture=$6,connected=$7,last_connected=$8,updated_at=$9
       WHERE id=$1 RETURNING *`,
      [
        data.id, data.email, data.google_id || null, data.google_name || null,
        data.email_verified || false, data.profile_picture || null, true,
        new Date(), new Date(),
      ]
    );
    logger.info("User updated", { id: data.id, rowCount: rows.length });
    return { ...rows[0], id: rows[0].id.toString() };
  },
  async createVerificationToken({ identifier, expires, token }) {
    logger.info("Creating verification token", { identifier });
    const { rows } = await query(
      `INSERT INTO verification_tokens (identifier,token,expires)
       VALUES ($1,$2,$3) RETURNING *`,
      [identifier, token, expires]
    );
    return rows[0];
  },
  async useVerificationToken({ identifier, token }) {
    logger.info("Using verification token", { identifier });
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
        await transporter.sendMail({
          to: identifier,
          from: provider.from,
          subject: "Sign in to Dashboard",
          html: `<p><a href="${url}">Sign in</a></p>`,
        });
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      try {
        logger.info("Sign-in attempt", { provider: account.provider, email: user.email });
        let email = user.email || "";
        let googleId = null, googleName = null, profilePic = "", verified = false, userId = null;

        if (account.provider === "google") {
          email = profile.email || "";
          profilePic = profile.picture || "";
          googleId = profile.sub;
          googleName = profile.name;
          verified = profile.email_verified || false;
          userId = googleId;
        } else if (account.provider === "email") {
          email = user.email || "";
          verified = true;
          userId = uuidv4();
        }

        if (!email) {
          logger.error("Sign-in failed: No email provided", { provider: account.provider });
          return false;
        }

        const existingUser = await query(`SELECT id FROM users WHERE google_id=$1`, [googleId]);
        if (existingUser.rows[0]) {
          userId = existingUser.rows[0].id;
        }

        const result = await query(
          `INSERT INTO users (id,email,google_id,google_name,email_verified,profile_picture,
             connected,last_connected,points,tweet_points,ai_points,task_points,is_creator,is_ai_rank,
             tier,is_plus,is_premium,api_key,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
           ON CONFLICT (google_id) DO UPDATE SET
             email=$2,google_name=$4,email_verified=$5,profile_picture=$6,connected=$7,
             last_connected=$8,updated_at=$19
           RETURNING *`,
          [
            userId, email, googleId, googleName, verified, profilePic, true, new Date(),
            0, 0, 0, 0, false, false, "Basic", false, false, randomBytes(32).toString("hex"), new Date(),
          ]
        );

        logger.info("User insert/update result", { userId, email, rowCount: result.rowCount });

        if (account.provider === "google") {
          await query(
            `INSERT INTO accounts (userId,type,provider,providerAccountId,access_token,expires_at,
               token_type,scope,id_token)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             ON CONFLICT (provider,providerAccountId) DO UPDATE SET
               access_token=$5,expires_at=$6,token_type=$7,scope=$8,id_token=$9`,
            [
              userId, account.type, account.provider, account.providerAccountId,
              account.access_token, null, account.token_type, account.scope, account.id_token,
            ]
          );
        }
        logger.info("Sign-in successful", { userId, email });
        return true;
      } catch (err) {
        logger.error("signIn error", { error: err.message, stack: err.stack });
        return false;
      }
    },
    async jwt({ token, account, profile }) {
      logger.info("JWT callback", { tokenId: token.id, email: token.email });
      if (account) {
        token.id = account.provider === "google" ? account.providerAccountId : token.sub || uuidv4();
        token.accessToken = account.access_token || randomBytes(32).toString("hex");
        token.expiresAt = Date.now() + 2 * 60 * 60 * 1000; // 2 hours
        token.email = profile?.email || token.email;
        token.googleName = profile?.name || "";
      }
      if (Date.now() > token.expiresAt) {
        // Implement refresh token logic here
        logger.info("Token expired, refreshing", { tokenId: token.id });
        token.accessToken = randomBytes(32).toString("hex");
        token.expiresAt = Date.now() + 2 * 60 * 60 * 1000;
      }
      const { rows } = await query(`SELECT api_key,is_premium FROM users WHERE id=$1`, [token.id]);
      if (rows[0]) {
        token.apiKey = rows[0].api_key;
        token.isPremium = rows[0].is_premium;
      }
      token.csrfToken = token.csrfToken || randomBytes(32).toString("hex");
      return token;
    },
    async session({ session, token }) {
      logger.info("Session callback", { userId: token.id });
      session.user.id = token.id;
      session.user.email = token.email;
      session.user.googleName = token.googleName;
      session.user.apiKey = token.apiKey;
      session.user.isPremium = token.isPremium || false;
      session.csrfToken = token.csrfToken;
      return session;
    },
  },
  secret: process.env.AUTH_SECRET,
  session: { strategy: "jwt", maxAge: 2 * 60 * 60 }, // 2 hours
  pages: {
    signIn: "/dashboard",
    error: "/auth/error",
  },
};