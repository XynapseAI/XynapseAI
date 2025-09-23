'use server';
import { revalidatePath } from 'next/cache';

export async function revalidateTokenPath(slug) {
  try {
    revalidatePath(`/dashboard?tab=market&token=${slug}`);
    return { success: true };
  } catch (error) {
    console.error(`Error revalidating path /dashboard?tab=market&token=${slug}:`, error);
    return { success: false, error: `Failed to revalidate path for token ${slug}: ${error.message}` };
  }
}