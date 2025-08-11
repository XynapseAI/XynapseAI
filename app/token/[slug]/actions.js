// app/token/[slug]/actions.js
'use server';
import { revalidatePath } from 'next/cache';

export async function revalidateTokenPath(slug) {
  try {
    revalidatePath(`/token/${slug}`); // Fixed string interpolation
    return { success: true };
  } catch (error) {
    console.error(`Error revalidating path /token/${slug}:`, error); // Fixed string interpolation
    return { success: false, error: error.message };
  }
}