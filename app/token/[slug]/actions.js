// app/token/[slug]/actions.js
'use server';
import { revalidatePath } from 'next/cache';

export async function revalidateTokenPath(slug) {
  try {
    revalidatePath(`/dashboard?tab=market&token=${slug}`); // Updated to new URL structure
    return { success: true };
  } catch (error) {
    console.error(`Error revalidating path /dashboard?tab=market&token=${slug}:`, error);
    return { success: false, error: error.message };
  }
}