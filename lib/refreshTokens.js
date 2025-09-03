import { query } from "@/utils/postgres";
import { logger } from "@/utils/serverLogger";

export async function refreshGoogleTokens() {
  const accounts = await query(
    `SELECT userId, refresh_token FROM accounts 
     WHERE provider='google' AND expires_at < $1`,
    [new Date(Date.now() + 10 * 60 * 1000)]
  );

  for (const account of accounts.rows) {
    try {
      const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          refresh_token: account.refresh_token,
          grant_type: "refresh_token",
        }),
      });
      const refreshedTokens = await response.json();
      if (!response.ok) throw new Error(refreshedTokens.error || "Failed to refresh token");

      await query(
        `UPDATE accounts SET access_token=$1, expires_at=$2 WHERE userId=$3 AND provider='google'`,
        [refreshedTokens.access_token, new Date(Date.now() + refreshedTokens.expires_in * 1000), account.userId]
      );
      logger.info("Google token refreshed via cron", { userId: account.userId });
    } catch (err) {
      logger.error("Cron refresh token error", { error: err.message, userId: account.userId });
    }
  }
}