import type { MetadataRoute } from "next";
import { getAppDomainMode } from "@/lib/app-domain";

export const dynamic = "force-dynamic";

export default function manifest(): MetadataRoute.Manifest {
  const isEcommerce = getAppDomainMode() === "ECOMMERCE_CS";

  if (isEcommerce) {
    return {
      name: "民声智理 · 全渠道电商售后客诉认知中枢与 AI 智能研判系统",
      short_name: "民声智理 电商客诉",
      description:
        "基于 System-1/2 快慢双系统协同、全渠道仓网矩阵与独立 Schema 物理隔离的电商售后客诉智能受理、多频聚类与假闭环主动治理平台",
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

  return {
    name: "民声智理 · 12345 政务热线认知中枢与 AI 智能研判系统",
    short_name: "民声智理 12345",
    description:
      "基于 System-1/2 快慢双系统协同、国家天地图 CGCS2000 空间底座与多城市 Schema 物理隔离的 12345 政务热线智能受理、多频研判与主动治理闭环平台",
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
