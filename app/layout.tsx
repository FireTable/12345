import type { Metadata } from "next";
import "./globals.css";
import "@/app/_components/civic/tokens.css";
import "@/app/_components/civic/components.css";
import "@/app/_components/civic/layout.css";
import "@/app/_components/civic/civic-pages.css";
import { CivicNav } from "@/app/_components/civic/civic-nav";
import { CivicWorkflowProvider } from "@/app/_components/civic/civic-workflow";
import { Toaster } from "@/app/_components/ui/sonner";

export const metadata: Metadata = {
  title: "顺德区12345热线智能工单管理平台",
  description: "12345 热线多频工单识别与核查",
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
