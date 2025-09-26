"use client";

import { motion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";

export default function LoginPrompt() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="flex flex-col items-center justify-center w-full h-full min-h-[200px] bg-transparent text-white p-4 sm:p-6"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3, delay: 0.2 }}
        className="flex flex-col items-center text-center"
      >
        <Image
          src="/logos/logo-landscape.webp"
          alt="Xynapse Logo"
          width={120}
          height={56}
          className="h-10 sm:h-12 w-auto mb-4"
          priority
        />
        <p className="text-[10px] sm:text-xs text-white/80 mb-4 max-w-xs">
          Please sign in to access this feature.
        </p>
        <Link
          href="/dashboard?tab=profile"
          className="px-4 py-2 bg-gray-800 text-white rounded-xl text-sm font-medium uppercase transition-all duration-300 hover:bg-gray-700 border border-white/20"
        >
          Sign In
        </Link>
      </motion.div>
    </motion.div>
  );
}