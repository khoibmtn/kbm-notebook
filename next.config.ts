import type { NextConfig } from "next";
import { securityHeaders } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg", "socket.io", "bufferutil", "utf-8-validate", "nodemailer", "busboy"],
  async headers() {
    return securityHeaders();
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
