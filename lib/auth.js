// lib/auth.js
import NextAuth from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/options";

export const { auth, signIn, signOut } = NextAuth(authOptions);
