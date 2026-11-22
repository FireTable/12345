import type { Metadata } from "next";
import "./globals.css";
import "@/app/_components/civic/tokens.css";
import "@/app/_components/civic/components.css";
import "@/app/_components/civic/layout.css";
import "@/app/_components/civic/civic-pages.css";
import "@/app/_components/cockpit/cockpit-glass.css";
import { CivicNav } from "@/app/_components/civic/civic-nav";
import { CivicWorkflowProvider } from "@/app/_components/civic/civic-workflow";
import { Toaster } from "@/app/_components/ui/sonner";
import { RegionProvider } from "@/app/_components/civic/region-context";
import { getAppDomainMode } from "@/lib/app-domain";
import { appViewport } from "./viewport";

export const dynamic = "force-dynamic";
export const viewport = appViewport;

export async function generateMetadata(): Promise<Metadata> {
  const appDomain = getAppDomainMode();
  const isEcommerce = appDomain === "ECOMMERCE_CS";
  const baseUrl = new URL(process.env.BETTER_AUTH_URL || "http://localhost:3000");

  if (isEcommerce) {
    return {
      metadataBase: baseUrl,
      title: {
        template: "%s | 民声智理 · 电商客诉中枢",
        default: "民声智理 · 全渠道电商售后客诉认知中枢与 AI 智能研判系统",
      },
      description:
        "基于 System-1/2 双引擎分层协同、PostgreSQL 多品牌 Schema 物理隔离与同款 SKU 客诉归并的电商全渠道多频客诉识别、图谱聚类与假闭环督办平台",
      keywords: [
        "电商客诉",
        "售后工单",
        "智能研判",
        "多频客诉",
        "实体图谱聚类",
        "假闭环追踪",
        "多租户",
        "SuperAgent",
        "民声智理",
        "快慢双系统",
        "MCP",
      ],
      authors: [{ name: "民声智理研发团队" }],
      creator: "民声智理 CivicRadar",
      publisher: "民声智理 CivicRadar",
      applicationName: "民声智理 电商客诉认知中枢",
      category: "E-Commerce Customer Service Intelligence",
      openGraph: {
        title: "民声智理 · 全渠道电商售后客诉认知中枢与 AI 智能研判系统",
        description: "快慢双系统协同、全渠道仓网矩阵与独立租户 Schema 物理隔离的智能客诉全闭环研判体系",
        url: "/",
        siteName: "民声智理",
        locale: "zh_CN",
        type: "website",
        images: [
          {
            url: "/og.png",
            width: 1200,
            height: 630,
            alt: "民声智理 · 全渠道电商售后客诉 AI 智能研判与督办系统",
          },
        ],
      },
      twitter: {
        card: "summary_large_image",
        title: "民声智理 · 电商客诉 AI 智能研判中枢",
        description: "工业级电商售后客诉 AI 双系统研判与风险预警中枢平台",
        images: ["/og.png"],
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
      icons: {
        icon: "/icon.svg",
        shortcut: "/icon.svg",
        apple: "/icon.svg",
      },
      manifest: "/manifest.webmanifest",
    };
  }

  return {
    metadataBase: baseUrl,
    title: {
      template: "%s | 民声智理 12345",
      default: "民声智理 · 12345 政务热线认知中枢与 AI 智能研判系统 (V2 Production)",
    },
    description:
      "基于 System-1/2 双引擎分层协同、PostgreSQL 多城市 Schema 物理隔离与同一事件归并的全国 12345 热线多频诉求智能识别、实体图谱聚类与全周期督办研判 SuperAgent 平台",
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
      images: [
        {
          url: "/og.png",
          width: 1200,
          height: 630,
          alt: "民声智理 · 12345 市民热线多频工单 AI 智能研判与治理系统",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "民声智理 · 12345 政务热线认知中枢",
      description: "工业级 12345 热线 AI 双系统研判与时空图谱聚类中枢平台",
      images: ["/og.png"],
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
    icons: {
      icon: "/icon.svg",
      shortcut: "/icon.svg",
      apple: "/icon.svg",
    },
    manifest: "/manifest.webmanifest",
    other: {
      "geo.region": "CN-GD",
      "geo.placename": "Guangdong",
      "geo.position": "22.80;113.29",
      ICBM: "22.80, 113.29",
    },
  };
}

function buildJsonLd(isEcommerce: boolean) {
  if (isEcommerce) {
    return {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "SoftwareApplication",
          name: "民声智理 · 全渠道电商售后客诉智能研判中枢",
          applicationCategory: "BusinessApplication",
          operatingSystem: "Linux, macOS, Docker",
          description: "基于 System-1/2 双引擎协同、渠道仓网矩阵与多租户隔离的电商售后客诉智能研判中枢系统",
          featureList: [
            "System 1 毫秒级食安与监管红线识别",
            "System 2 大模型 SKU 与履约责任实体精准抽取",
            "全渠道店铺与仓储物流客诉热力矩阵",
            "同款 SKU 跨渠道批量客诉聚类归并",
            "多品牌 PostgreSQL Schema 物理隔离",
            "售后假闭环预警与 SLA 督办闭环",
            "原生 Model Context Protocol (MCP) 互联生态",
          ],
        },
      ],
    };
  }

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SoftwareApplication",
        name: "民声智理 · 12345 政务热线认知中枢",
        applicationCategory: "GovernmentApplication",
        operatingSystem: "Linux, macOS, Docker",
        description: "基于 System-1/2 双引擎协同、高精测绘级 GIS 底图与多租户隔离的 12345 热线智能研判中枢系统",
        featureList: [
          "System 1 毫秒级端侧边缘神经分类器",
          "System 2 本地百亿大模型精准结构化要素抽取",
          "国家天地图 CGCS2000 高精无偏移 GIS 空间底图",
          "微观道路基底提纯与同案同地精准时空聚类",
          "多城市 PostgreSQL Schema 物理隔离与 AI Scout 拓荒",
          "办结后 7 天时序假闭环预警与智能督办",
          "原生 Model Context Protocol (MCP) 互联生态",
        ],
      },
      {
        "@type": "GovernmentService",
        name: "12345 民声热线态势感知与决策研判服务",
        serviceType: "Public Hotline Cognitive Analytics",
        areaServed: [
          {
            "@type": "AdministrativeArea",
            name: "佛山市顺德区",
          },
          {
            "@type": "AdministrativeArea",
            name: "广州市天河区",
          },
        ],
      },
    ],
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const appDomain = getAppDomainMode();
  const isEcommerce = appDomain === "ECOMMERCE_CS";
  const jsonLd = buildJsonLd(isEcommerce);

  return (
    <html lang="zh-CN">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <script
          id="tianditu-runtime-config"
          dangerouslySetInnerHTML={{
            __html: `window.__TIANDITU_TK__ = ${JSON.stringify(process.env.NEXT_PUBLIC_TIANDITU_TK || "")};`,
          }}
        />
      </head>
      <body>
        <a href="#main-content" className="skip-link">
          跳转到主要内容
        </a>
        <RegionProvider initialAppDomain={appDomain}>
          <CivicWorkflowProvider>
            <CivicNav />
            <main id="main-content" className="main">
              {children}
            </main>
            <Toaster />
          </CivicWorkflowProvider>
        </RegionProvider>
      </body>
    </html>
  );
}
