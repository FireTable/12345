import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Standalone build → minimal runtime image (see Dockerfile)
  output: "standalone",
  // Support server external packages if needed
  serverExternalPackages: [
    "@langchain/langgraph",
    "@langchain/core",
    "onnxruntime-node",
    "@civic/system-one",
    "@civic/system-two",
    "@civic/anonymizer",
    "busboy",
    "adm-zip",
  ],
  experimental: {
    serverActions: {
      bodySizeLimit: "300mb",
    },
  },
  async rewrites() {
    return [
      {
        source: "/.well-known/oauth-protected-resource",
        destination: "/api/mcp/oauth-protected-resource",
      },
      {
        source: "/.well-known/oauth-protected-resource/:path*",
        destination: "/api/mcp/oauth-protected-resource",
      },
      {
        source: "/.well-known/oauth-authorization-server",
        destination: "/api/mcp/oauth-authorization-server",
      },
    ];
  },
};

export default nextConfig;
