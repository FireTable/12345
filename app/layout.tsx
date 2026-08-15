import type { Metadata } from "next";
import "./globals.css";
import "@/app/_components/civic/tokens.css";
import "@/app/_components/civic/components.css";
import "@/app/_components/civic/layout.css";
import "@/app/_components/civic/civic-pages.css";
import { CivicNav } from "@/app/_components/civic/civic-nav";
import { CivicWorkflowProvider } from "@/app/_components/civic/civic-workflow";
import { Toaster } from "@/app/_components/ui/sonner";
import { appViewport } from "./viewport";

export const viewport = appViewport;

export const metadata: Metadata = {
  title: "顺德 12345 AI 智能研判系统",
  description: "顺德 12345 热线多频诉求 AI 智能研判与治理平台",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        <CivicWorkflowProvider>
          <CivicNav />
          <main className="main">{children}</main>
          <Toaster />
        </CivicWorkflowProvider>
      </body>
    </html>
  );
}
