import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Emit a self-contained server bundle (.next/standalone) for the Docker
  // image. Ignored by Vercel, which does its own tracing.
  output: "standalone",
  // Pin the workspace root to this project so Next doesn't pick up a stray
  // package-lock.json from a parent directory (e.g. the home folder).
  turbopack: {
    root: path.resolve(),
  },
};

export default nextConfig;
