import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets a production build run beside `pnpm dev` without overwriting its
  // .next folder: NEXT_DIST_DIR=.next-build pnpm build
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
