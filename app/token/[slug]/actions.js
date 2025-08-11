// app/token/[slug]/actions.js
'use server';
import { revalidatePath } from 'next/cache';

export async function revalidateTokenPath(slug) {
  try {
    revalidatePath(`/dashboard?tab=market&slug=${encodeURIComponent(slug)}`);
    return { success: true };
  } catch (error) {
    console.error(`Error revalidating path /dashboard?tab=market&slug=${slug}:`, error);
    return { success: false, error: error.message };
  }
}