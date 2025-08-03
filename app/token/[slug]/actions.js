// app/token/[slug]/actions.js
'use server';

import { revalidatePath } from 'next/cache';
import { logger } from '../../../utils/serverLogger';

export async function revalidateTokenPath(slug) {
  try {
    if (!slug || typeof slug !== 'string' || slug.trim() === '') {
      logger.error(`Invalid slug for revalidation: ${slug}`);
      return { success: false, error: 'Invalid slug' };
    }
    logger.info(`Revalidating path /token/${slug}`);
    revalidatePath(`/token/${slug}`);
    return { success: true };
  } catch (error) {
    logger.error(`Error revalidating path /token/${slug}: ${error.message}`, { stack: error.stack });
    return { success: false, error: error.message };
  }
}