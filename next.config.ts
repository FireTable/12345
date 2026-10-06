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
    proxyClientMaxBodySize: "300mb",
    serverActions: {
      bodySizeLimit: "300mb",
    },
  } as any,
};

export default nextConfig;
