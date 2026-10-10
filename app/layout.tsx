import type { Metadata } from "next";
import "./globals.css";
import "@/app/_components/civic/tokens.css";
import "@/app/_components/civic/components.css";
import "@/app/_components/civic/layout.css";
import "@/app/_components/civic/civic-pages.css";
import "@/app/workbench/workbench.css";
import "@/app/_components/cockpit/cockpit-glass.css";
import "leaflet/dist/leaflet.css";
import { CivicNav } from "@/app/_components/civic/civic-nav";
import { CivicWorkflowProvider } from "@/app/_components/civic/civic-workflow";
import { PipelineDrawer } from "@/app/_components/civic/pipeline-drawer";
import { Toaster } from "@/app/_components/ui/sonner";
import { appViewport } from "./viewport";

import { RegionProvider } from "@/app/_components/civic/region-context";

export const viewport = appViewport;

export const metadata: Metadata = {
  metadataBase: new URL(process.env.BETTER_AUTH_URL || "http://localhost:3000"),
  title: {
    template: "%s | 民声智理 12345",
    default: "民声智理 · 12345 政务热线认知中枢与 AI 智能研判系统 (V2 Production)",
  },
  description: "基于 System-1/2 双引擎分层协同、PostgreSQL 多城市 Schema 物理隔离与同一事件归并的全国 12345 热线多频诉求智能识别、实体图谱聚类与全周期督办研判 SuperAgent 平台",
  keywords: [
    "12345",
    "政务热线",
    "智能研判",
    "多频工单",
    "实体图谱聚类",
    "假闭环追踪",
    "多租户",
    "SuperAgent",
    "民声智理",
    "时空聚类",
    "天地图",
    "CGCS2000",
    "快慢双系统",
    "MCP",
  ],
  authors: [{ name: "民声智理研发团队" }],
  creator: "民声智理 CivicRadar",
  publisher: "民声智理 CivicRadar",
  applicationName: "民声智理 12345 认知中枢",
  category: "Government Intelligence & AI Analytics",
  openGraph: {
    title: "民声智理 · 12345 政务热线认知中枢与 AI 智能研判系统",
    description: "认知科学快慢双系统协同、CGCS2000 测绘级高精空间底图与多城市 Schema 隔离的政务民生诉求全闭环研判体系",
    url: "/",
    siteName: "民声智理 CivicRadar",
    locale: "zh_CN",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "民声智理 · 12345 政务热线认知中枢",
    description: "工业级 12345 热线 AI 双系统研判与时空图谱聚类中枢平台",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  other: {
    "geo.region": "CN-GD",
    "geo.placename": "Guangdong",
    "geo.position": "22.80;113.29",
    "ICBM": "22.80, 113.29",
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      "name": "民声智理 · 12345 政务热线认知中枢",
      "applicationCategory": "GovernmentApplication",
      "operatingSystem": "Linux, macOS, Docker",
      "description": "基于 System-1/2 双引擎协同、高精测绘级 GIS 底图与多租户隔离的 12345 热线智能研判中枢系统",
      "featureList": [
        "System 1 毫秒级端侧边缘神经分类器",
        "System 2 本地百亿大模型精准结构化要素抽取",
        "国家天地图 CGCS2000 高精无偏移 GIS 空间底图",
        "微观道路基底提纯与同案同地精准时空聚类",
        "多城市 PostgreSQL Schema 物理隔离与 AI Scout 拓荒",
        "办结后 7 天时序假闭环预警与智能督办",
        "原生 Model Context Protocol (MCP) 互联生态"
      ]
    },
    {
      "@type": "GovernmentService",
      "name": "12345 民声热线态势感知与决策研判服务",
      "serviceType": "Public Hotline Cognitive Analytics",
      "areaServed": [
        {
          "@type": "AdministrativeArea",
          "name": "佛山市顺德区"
        },
        {
          "@type": "AdministrativeArea",
          "name": "广州市天河区"
        }
      ]
    }
  ]
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body>
        <RegionProvider>
          <CivicWorkflowProvider>
            <CivicNav />
            <main className="main">{children}</main>
            <PipelineDrawer />
            <Toaster />
          </CivicWorkflowProvider>
        </RegionProvider>
      </body>
    </html>
  );
}
