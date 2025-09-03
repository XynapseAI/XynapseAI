import cron from "node-cron";
import { refreshGoogleTokens } from "@/lib/refreshTokens";
import { logger } from "@/utils/serverLogger";

cron.schedule("*/5 * * * *", () => {
  logger.info("Running token refresh cron job");
  refreshGoogleTokens();
});