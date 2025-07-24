// app/token/[slug]/actions.js
'use server';

import { revalidatePath } from 'next/cache';

export async function revalidateTokenPath(slug) {
  try {
    revalidatePath(`/token/${slug}`);
    return { success: true };
  } catch (error) {
    console.error(`Error revalidating path /token/${slug}:`, error);
    return { success: false, error: error.message };
  }
}