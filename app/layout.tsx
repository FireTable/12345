import type { Metadata } from "next";
import "./globals.css";
import "@/app/_components/civic/tokens.css";
import "@/app/_components/civic/components.css";
import "@/app/_components/civic/layout.css";
import "@/app/_components/civic/civic-pages.css";
import "@/app/_components/civic/voice-chat-composer.css";
import "@/app/_components/copilot/copilot-md.css";
import "@/app/_components/cockpit/cockpit-glass.css";
import { CivicNav } from "@/app/_components/civic/civic-nav";
import { CivicWorkflowProvider } from "@/app/_components/civic/civic-workflow";
import { Toaster } from "@/app/_components/ui/sonner";
import { RegionProvider } from "@/app/_components/civic/region-context";
import { getAppDomainMode } from "@/lib/app-domain";
import { appViewport } from "./viewport";

export const dynamic = "force-dynamic";
export const viewport = appViewport;

function resolveSiteBaseUrl(isEcommerce: boolean): URL {
  const fallback = isEcommerce
    ? "https://ecom.firetable.tech"
    : "https://12345.firetable.tech";
  const raw = (process.env.BETTER_AUTH_URL || "").trim();
  if (!raw) {
    return new URL(fallback);
  }
  try {
    return new URL(raw);
  } catch {
    return new URL(fallback);
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const appDomain = getAppDomainMode();
  const isEcommerce = appDomain === "ECOMMERCE_CS";
  const baseUrl = resolveSiteBaseUrl(isEcommerce);

  if (isEcommerce) {
    return {
      metadataBase: baseUrl,
      title: {
        template: "%s | 民声智理 · 电商客诉中枢",
        default: "民声智理 · 全渠道电商售后客诉认知中枢与 AI 智能研判系统",
      },
      description:
        "基于 System-1/2 快慢双系统协同、PostgreSQL 多品牌 Schema 物理隔离、3D 数字人语音受理与 L1/L2/L3 主动治理的电商全渠道多频客诉识别、SKU 图谱聚类、缺资料外呼补全与 48h 假闭环督办平台",
      keywords: [
        "电商客诉",
        "售后工单",
        "智能研判",
        "多频客诉",
        "SKU 聚类",
        "实体图谱聚类",
        "假闭环追踪",
        "48h 回访",
        "AI 智能治理",
        "数字人受理",
        "隐私脱敏防火墙",
        "多租户",
        "民声智理",
        "CivicPulse",
        "快慢双系统",
        "MCP",
      ],
      authors: [{ name: "民声智理研发团队（赢了就回家吃鱼生）" }],
      creator: "民声智理 CivicPulse",
      publisher: "民声智理 CivicPulse",
      applicationName: "民声智理 · 电商客诉认知中枢",
      category: "E-Commerce Customer Service Intelligence",
      openGraph: {
        title: "民声智理 · 全渠道电商售后客诉认知中枢与 AI 智能研判系统",
        description:
          "快慢双系统协同、3D 数字人语音受理、全渠道仓网矩阵、缺资料 Agent 外呼补全与 48h 假闭环主动治理的电商客诉闭环研判平台（ecom.firetable.tech）",
        url: "/",
        siteName: "民声智理 CivicPulse · 电商客诉中枢",
        locale: "zh_CN",
        type: "website",
        images: [
          {
            url: "/og.png",
            width: 1200,
            height: 630,
            alt: "民声智理 · 全渠道电商售后客诉 AI 智能研判与主动治理系统",
          },
        ],
      },
      twitter: {
        card: "summary_large_image",
        title: "民声智理 · 全渠道电商售后客诉 AI 智能研判中枢",
        description:
          "工业级电商售后客诉 AI 双系统研判、SKU 多频聚类、L1/L2/L3 主动治理与 48h 假闭环预警平台",
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
      default: "民声智理 · 12345 政务热线认知中枢与 AI 智能研判治理系统",
    },
    description:
      "基于 System-1/2 快慢双系统协同、PostgreSQL 多城市 Schema 物理隔离、国家天地图 CGCS2000 空间底座、3D 数字人市民受理与 L1/L2/L3 主动治理的 12345 热线多频诉求识别、同案同地聚类、缺资料语音补全与 48h 假闭环督办平台",
    keywords: [
      "12345",
      "政务热线",
      "市民热线",
      "智能研判",
      "多频工单",
      "同案同地聚类",
      "实体图谱聚类",
      "假闭环追踪",
      "48h 满意度回访",
      "AI 智能治理",
      "数字人受理",
      "隐私脱敏",
      "多租户",
      "SuperAgent",
      "民声智理",
      "CivicPulse",
      "天地图",
      "CGCS2000",
      "快慢双系统",
      "MCP",
    ],
    authors: [{ name: "民声智理研发团队（赢了就回家吃鱼生）" }],
    creator: "民声智理 CivicPulse",
    publisher: "民声智理 CivicPulse",
    applicationName: "民声智理 12345 认知中枢",
    category: "Government Intelligence & AI Analytics",
    openGraph: {
      title: "民声智理 · 12345 政务热线认知中枢与 AI 智能研判治理系统",
      description:
        "快慢双系统协同、CGCS2000 测绘级底图、3D 数字人语音受理、缺资料 Agent 外呼补全、L1/L2/L3 红线熔断与 3 层 PII 脱敏防火墙的 12345 全闭环治理平台（12345.firetable.tech）",
      url: "/",
      siteName: "民声智理 CivicPulse 12345",
      locale: "zh_CN",
      type: "website",
      images: [
        {
          url: "/og.png",
          width: 1200,
          height: 630,
          alt: "民声智理 · 12345 市民热线多频工单 AI 智能研判与主动治理系统",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "民声智理 · 12345 政务热线认知中枢与 AI 智能研判系统",
      description:
        "工业级 12345 热线快慢双系统研判、时空多频聚类、缺资料语音补全与 48h 假闭环主动治理平台",
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
      "geo.position": "23.13;113.36",
      ICBM: "23.13, 113.36",
    },
  };
}

function buildJsonLd(isEcommerce: boolean, baseUrl: URL) {
  const origin = baseUrl.origin;
  const organization = {
    "@type": "Organization",
    "@id": `${origin}/#organization`,
    name: "民声智理核心工程研判组（赢了就回家吃鱼生）",
    url: "https://12345.firetable.tech",
    sameAs: [
      "https://github.com/FireTable/12345",
      "https://12345.firetable.tech",
      "https://ecom.firetable.tech",
    ],
  };

  if (isEcommerce) {
    return {
      "@context": "https://schema.org",
      "@graph": [
        organization,
        {
          "@type": "WebSite",
          "@id": `${origin}/#website`,
          name: "民声智理 · 电商售后客诉认知中枢",
          url: origin,
          inLanguage: "zh-CN",
          publisher: { "@id": `${origin}/#organization` },
        },
        {
          "@type": "SoftwareApplication",
          "@id": `${origin}/#software`,
          name: "民声智理 · 全渠道电商售后客诉智能研判与主动治理中枢",
          alternateName: "CivicPulse E-Commerce CS Intelligence",
          url: origin,
          softwareVersion: "0.1.5",
          applicationCategory: "BusinessApplication",
          operatingSystem: "Linux, macOS, Docker, Web",
          inLanguage: "zh-CN",
          license: "https://opensource.org/licenses/MIT",
          sameAs: [
            "https://github.com/FireTable/12345",
            "https://12345.firetable.tech",
          ],
          publisher: { "@id": `${origin}/#organization` },
          description:
            "基于 System-1/2 快慢双系统协同、全渠道仓网矩阵、PostgreSQL 独立 Schema 物理隔离与三层出网 PII 脱敏防火墙的电商售后客诉智能受理、SKU 多频聚类与 48h 假闭环主动治理平台，预置 3,240 条全渠道客诉与 40 个专题。",
          featureList: [
            "3D 数字人（小蠢）与流式语音买家客诉受理（/submit）及实时进度追踪",
            "System-1 端侧 4-Head ONNX 毫秒级分类与食安/12315 监管红线拦截",
            "System-2 通用大模型 SKU 与履约责任实体精准抽取及多节点算力池",
            "全渠道店铺与仓储物流客诉热力矩阵及同款 SKU 跨渠道多频聚类（/themes）",
            "工单中心 4 态统一流转、缺资料自动识别与一键 Agent 语音外呼补全（/tickets）",
            "智能治理 L1 自动执行 / L2 人工审批 / L3 红线熔断与 48h 挽回回访（/agent）",
            "AI 研判副驾驶 LightCopilot 1 轮极速简报、3 层 PII 防火墙与可执行提案卡片",
            "多品牌 PostgreSQL Schema 物理隔离与原生 Model Context Protocol (MCP 2025-03-26)",
          ],
        },
        {
          "@type": "FAQPage",
          "@id": `${origin}/#faq`,
          mainEntity: [
            {
              "@type": "Question",
              name: "民声智理电商客诉示范站与 12345 政务主站是什么关系？",
              acceptedAnswer: {
                "@type": "Answer",
                text: "两站复用同一生产镜像（ticket-radar:v0.1.5），通过 APP_DOMAIN 环境变量（GOV_12345 与 ECOMMERCE_CS）及 PostgreSQL 独立 Schema 实现双容器、双域名物理隔离部署：12345.firetable.tech 服务政务热线，ecom.firetable.tech 服务全渠道电商售后客诉。",
              },
            },
            {
              "@type": "Question",
              name: "系统如何防止电商售后敷衍结案与买家隐私外泄？",
              acceptedAnswer: {
                "@type": "Answer",
                text: "系统内置 48 小时满意度回访与假闭环自动重开机制，买家也可在受理页一键重开未解决客诉；同时所有出网大模型请求均经过 @civic/anonymizer 可逆脱敏、Copilot 消息审查与 CloudOpenAIAdapter 末公里 PII 清洗三层出网脱敏防火墙。",
              },
            },
            {
              "@type": "Question",
              name: "L1 / L2 / L3 三级智能治理权限如何划分？",
              acceptedAnswer: {
                "@type": "Answer",
                text: "L1 自动执行覆盖多频专题超期催办（SLA_OVERDUE）与电商低风险缺资料语音补全（MISSING_INFO）；L2 人工审批覆盖 48h 满意度回访/假闭环重开（REOPEN_CALLBACK）及 Copilot 派单/升级/办结提案，必须由人工确认后生效；L3 红线熔断（REDLINE_BLOCK）在命中食品安全、12315 监管或社媒舆情红线时强制拦截 AI 自动外联，直接转交法务与主管专班人工接管。",
              },
            },
          ],
        },
      ],
    };
  }

  return {
    "@context": "https://schema.org",
    "@graph": [
      organization,
      {
        "@type": "WebSite",
        "@id": `${origin}/#website`,
        name: "民声智理 · 12345 政务热线认知中枢",
        url: origin,
        inLanguage: "zh-CN",
        publisher: { "@id": `${origin}/#organization` },
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${origin}/#software`,
        name: "民声智理 · 12345 政务热线认知中枢与 AI 智能研判治理系统",
        alternateName: "CivicPulse 12345",
        url: origin,
        softwareVersion: "0.1.5",
        applicationCategory: "GovernmentApplication",
        operatingSystem: "Linux, macOS, Docker, Web",
        inLanguage: "zh-CN",
        license: "https://opensource.org/licenses/MIT",
        sameAs: [
          "https://github.com/FireTable/12345",
          "https://ecom.firetable.tech",
        ],
        publisher: { "@id": `${origin}/#organization` },
        description:
          "基于 System-1/2 快慢双系统协同、国家天地图 CGCS2000 测绘级底图、PostgreSQL 多城市 Schema 物理隔离与三层 PII 脱敏防火墙的 12345 政务热线全闭环平台，默认内置广州市天河区（~10.6 万条）与佛山市顺德区（~13.8 万条）示范数据。",
        featureList: [
          "3D 数字人（小蠢）与流式语音市民诉求受理（/submit）、自动脱敏建单与进度追踪",
          "System-1 端侧 4-Head ONNX 神经分类器（0.079ms / 12,664 TPS）与 11 类涉稳硬红线互锁",
          "System-2 慢思考通用大模型（27B Metal 集群 / Colab GPU / 云端容灾）四要素结构化抽取",
          "国家天地图 CGCS2000 测绘级底图、四级镇街矢量面与同案同地时空语义聚类（/themes）",
          "工单中心 4 态统一流转、缺资料索引识别（0.25ms 级分页）与一键 Agent 语音外呼补全（/tickets）",
          "智能治理 L1 自动执行 / L2 人工审批 / L3 红线熔断、48h 满意度回访与假闭环狙击（/agent）",
          "AI 研判副驾驶 LightCopilot 1 轮极速简报、3 层出网 PII 防火墙与可执行提案卡片",
          "PostgreSQL region_{id} 物理隔离、SuperAgent AI Scout 30 秒拓荒与原生 MCP 2025-03-26",
        ],
      },
      {
        "@type": "GovernmentService",
        "@id": `${origin}/#service`,
        name: "12345 民声热线智能受理、态势感知与主动治理研判服务",
        serviceType: "Public Hotline Cognitive Analytics & Governance",
        provider: { "@id": `${origin}/#organization` },
        areaServed: [
          {
            "@type": "AdministrativeArea",
            name: "广州市天河区",
          },
          {
            "@type": "AdministrativeArea",
            name: "佛山市顺德区",
          },
        ],
      },
      {
        "@type": "FAQPage",
        "@id": `${origin}/#faq`,
        mainEntity: [
          {
            "@type": "Question",
            name: "民声智理 12345 如何兼顾十万级工单高并发研判与公民隐私保护？",
            acceptedAnswer: {
              "@type": "Answer",
              text: "平台采用 Kahneman 快慢双系统架构：System-1 本地 4-Head ONNX 模型在 0.079ms 内完成意图、分类、时限与涉稳初筛；所有送入大模型的文本均经 @civic/anonymizer（13μs、支持身份证校验和/车牌/手机/邮箱/私密房号/姓名 6 类 PII 可逆脱敏）、Copilot 审查层与云端末公里清洗三层脱敏防火墙，保障公民隐私不出域。",
            },
          },
          {
            "@type": "Question",
            name: "什么是“假闭环”时序狙击与 48h 满意度回访？",
            acceptedAnswer: {
              "@type": "Answer",
              text: "针对“表面按时办结、群众问题未彻底解决”的顽疾，系统结合办结后复发时间窗识别、48h AI 满意度语音回访以及市民端一键申请重开，自动判定疑似假闭环工单并将关联专题重开升级为高危督办。",
            },
          },
          {
            "@type": "Question",
            name: "系统如何支撑多城市迁移与跨行业复用？",
            acceptedAnswer: {
              "@type": "Answer",
              text: "系统基于 PostgreSQL 独立 Schema（region_{id}）实现多租户物理隔离，并内置 SuperAgent AI Scout 30 秒拓荒新辖区边界与词库；通过 APP_DOMAIN 开关可复用同一 Docker 镜像独立运行 12345 政务版（12345.firetable.tech）与电商客诉版（ecom.firetable.tech）。",
            },
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
  const baseUrl = resolveSiteBaseUrl(isEcommerce);
  const jsonLd = buildJsonLd(isEcommerce, baseUrl);

  return (
    <html lang="zh-CN">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
          }}
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
