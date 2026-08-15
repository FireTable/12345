import type { Metadata } from "next";
import { Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/app/_components/ui/sonner";

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

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
    <html lang="zh-CN" className="dark">
      <body
        className={`${plusJakartaSans.variable} ${jetbrainsMono.variable} bg-slate-950 text-slate-100 min-h-screen antialiased selection:bg-cyan-500 selection:text-white`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
