import NextAuth from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/options";

// Tạo instance NextAuth cho toàn bộ app
export const { auth, signIn, signOut } = NextAuth(authOptions);

// Nếu bạn cần một hàm lấy session trong server component:
export async function getAuthSession() {
  return await auth();
}
