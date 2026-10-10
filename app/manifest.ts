import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "民声智理 · 12345 政务热线认知中枢与 AI 智能研判系统",
    short_name: "民声智理 12345",
    description: "工业级 12345 热线 AI 双系统研判与时空图谱聚类中枢平台",
    start_url: "/",
    display: "standalone",
    background_color: "#F8FAFC",
    theme_color: "#1677FF",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
