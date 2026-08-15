import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/app/_components/ui/sonner";

export const metadata: Metadata = {
  title: "Ticket Radar — 多频工单智能识别与核查分析系统",
  description: "基于轻量GraphRAG与持久化LangGraph JS的热线多频诉求智能识别与批量核查看板",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="light">
      <body className="bg-slate-50 text-slate-900 min-h-screen antialiased selection:bg-blue-600 selection:text-white">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
