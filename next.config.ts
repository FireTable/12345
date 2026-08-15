import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Support server external packages if needed
  serverExternalPackages: ["@langchain/langgraph", "@langchain/core"],
};

export default nextConfig;
