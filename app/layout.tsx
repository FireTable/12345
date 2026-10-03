import type { Metadata } from "next";
import "./globals.css";
import "@/app/_components/civic/tokens.css";
import "@/app/_components/civic/components.css";
import "@/app/_components/civic/layout.css";
import "@/app/_components/civic/civic-pages.css";
import "@/app/workbench/workbench.css";
import "leaflet/dist/leaflet.css";
import { CivicNav } from "@/app/_components/civic/civic-nav";
import { CivicWorkflowProvider } from "@/app/_components/civic/civic-workflow";
import { PipelineDrawer } from "@/app/_components/civic/pipeline-drawer";
import { Toaster } from "@/app/_components/ui/sonner";
import { appViewport } from "./viewport";

import { RegionProvider } from "@/app/_components/civic/region-context";

export const viewport = appViewport;

export const metadata: Metadata = {
  title: {
    template: "%s | 民声智理 12345",
    default: "民声智理 · 12345 政务热线认知中枢与 AI 智能研判系统",
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
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
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
