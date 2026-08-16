import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const PITCH_DIR = path.join(ROOT, "docs", "pitch");

const BASE_CSS = `
@page {
  size: A4;
  margin: 16mm 14mm 16mm 14mm;
}

* {
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "WenQuanYi Micro Hei", sans-serif;
  color: #1e293b;
  line-height: 1.6;
  font-size: 13px;
  background-color: #ffffff;
  margin: 0;
  padding: 0;
}

.pdf-header {
  border-bottom: 2px solid #2563eb;
  padding-bottom: 10px;
  margin-bottom: 20px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.pdf-header .brand {
  font-size: 13px;
  font-weight: 700;
  color: #1e3a8a;
  letter-spacing: 0.5px;
}

.pdf-header .badge {
  display: inline-block;
  font-size: 11px;
  background-color: #eff6ff;
  color: #2563eb;
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid #bfdbfe;
}

h1 {
  font-size: 22px;
  color: #0f172a;
  border-left: 5px solid #2563eb;
  padding-left: 12px;
  margin-top: 0;
  margin-bottom: 16px;
  line-height: 1.3;
  page-break-after: avoid;
}

h2 {
  font-size: 16px;
  color: #1e3a8a;
  border-bottom: 1px solid #e2e8f0;
  padding-bottom: 6px;
  margin-top: 24px;
  margin-bottom: 12px;
  page-break-after: avoid;
}

h3 {
  font-size: 14px;
  color: #334155;
  margin-top: 16px;
  margin-bottom: 8px;
  page-break-after: avoid;
}

h4, h5, h6 {
  font-size: 13px;
  color: #475569;
  margin-top: 12px;
  margin-bottom: 6px;
  page-break-after: avoid;
}

p {
  margin-top: 0;
  margin-bottom: 10px;
}

ul, ol {
  margin-top: 0;
  margin-bottom: 10px;
  padding-left: 20px;
}

li {
  margin-bottom: 4px;
}

blockquote {
  margin: 12px 0;
  padding: 8px 14px;
  background-color: #f8fafc;
  border-left: 4px solid #3b82f6;
  border-radius: 0 6px 6px 0;
  color: #334155;
  font-size: 12.5px;
  page-break-inside: avoid;
}

blockquote p:last-child {
  margin-bottom: 0;
}

table {
  width: 100%;
  border-collapse: collapse;
  margin: 12px 0 16px 0;
  font-size: 12px;
  page-break-inside: avoid;
}

th, td {
  border: 1px solid #cbd5e1;
  padding: 6px 10px;
  text-align: left;
  vertical-align: top;
}

th {
  background-color: #f1f5f9;
  font-weight: 600;
  color: #1e293b;
}

tr:nth-child(even) {
  background-color: #f8fafc;
}

code {
  font-family: Menlo, Monaco, Consolas, "Courier New", monospace;
  font-size: 11.5px;
  background-color: #f1f5f9;
  color: #0f172a;
  padding: 2px 4px;
  border-radius: 4px;
  border: 1px solid #e2e8f0;
}

pre {
  font-family: Menlo, Monaco, Consolas, "Courier New", monospace;
  font-size: 11px;
  background-color: #0f172a;
  color: #f8fafc;
  padding: 12px;
  border-radius: 6px;
  overflow-x: auto;
  margin: 12px 0;
  page-break-inside: avoid;
}

pre code {
  background-color: transparent;
  color: inherit;
  border: none;
  padding: 0;
}

hr {
  border: none;
  border-top: 1px dashed #cbd5e1;
  margin: 18px 0;
}

img {
  max-width: 100%;
  height: auto;
  border-radius: 6px;
  border: 1px solid #e2e8f0;
  display: block;
  margin: 12px auto;
  page-break-inside: avoid;
}

a {
  color: #2563eb;
  text-decoration: none;
}

strong {
  color: #0f172a;
}
`;

function buildHtmlDocument(title: string, markdownContent: string, bannerSubtitle?: string): string {
  // Pre-process mermaid or special image tags if needed
  let processedMd = markdownContent;

  // If contains mermaid diagram in WORKFLOW.md, replace mermaid code block with topology PNG image
  if (processedMd.includes("```mermaid")) {
    const topologyImgPath = path.join(PITCH_DIR, "赢了就回家吃鱼生团队_民声智理_技术架构与工作流拓扑.png");
    if (fs.existsSync(topologyImgPath)) {
      processedMd = processedMd.replace(
        /```mermaid[\s\S]*?```/g,
        `![工作流架构与拓扑关系](file://${topologyImgPath})`
      );
    }
  }

  const rawHtml = renderToStaticMarkup(
    React.createElement(
      ReactMarkdown,
      {
        remarkPlugins: [remarkGfm],
      },
      processedMd
    )
  );

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <style>
    ${BASE_CSS}
  </style>
</head>
<body>
  <div class="pdf-header">
    <span class="brand">民声智理 · 顺德 12345 AI 智能研判系统</span>
    <span class="badge">${bannerSubtitle || "赢了就回家吃鱼生团队 · 交付材料"}</span>
  </div>
  <div class="content">
    ${rawHtml}
  </div>
</body>
</html>`;
}

interface PdfJob {
  sourceMdPath: string;
  targetPdfPath: string;
  title: string;
  subtitle: string;
}

const jobs: PdfJob[] = [
  {
    sourceMdPath: path.join(PITCH_DIR, "赢了就回家吃鱼生团队_民声智理_项目说明.md"),
    targetPdfPath: path.join(PITCH_DIR, "赢了就回家吃鱼生团队_民声智理_项目说明.pdf"),
    title: "民声智理 — 项目说明",
    subtitle: "大赛官方申报材料 · 项目解决方案",
  },
  {
    sourceMdPath: path.join(PITCH_DIR, "赢了就回家吃鱼生团队_民声智理_AI工具与开源组件说明.md"),
    targetPdfPath: path.join(PITCH_DIR, "赢了就回家吃鱼生团队_民声智理_AI工具与开源组件说明.pdf"),
    title: "民声智理 — AI 工具与开源组件说明",
    subtitle: "大赛官方申报材料 · 合规与依赖清单",
  },
  {
    sourceMdPath: path.join(ROOT, "docs", "WORKFLOW.md"),
    targetPdfPath: path.join(PITCH_DIR, "赢了就回家吃鱼生团队_民声智理_技术架构与工作流.pdf"),
    title: "民声智理 — 技术架构与工作流拓扑",
    subtitle: "系统全景架构 · LangGraph 图工作流规范",
  },
  {
    sourceMdPath: path.join(PITCH_DIR, "DEMO_CASES.md"),
    targetPdfPath: path.join(PITCH_DIR, "赢了就回家吃鱼生团队_民声智理_路演实战高光案例库.pdf"),
    title: "民声智理 — 路演现场高光演示案例库",
    subtitle: "路演答辩支撑 · 四大杀手级案例解析",
  },
  {
    sourceMdPath: path.join(PITCH_DIR, "QA_DEFENSE.md"),
    targetPdfPath: path.join(PITCH_DIR, "赢了就回家吃鱼生团队_民声智理_评委问答与答辩防御手册.pdf"),
    title: "民声智理 — 评委问答与答辩防御手册",
    subtitle: "路演答辩支撑 · 10大尖锐问题深度应答",
  },
  {
    sourceMdPath: path.join(PITCH_DIR, "PITCH_SCRIPT.md"),
    targetPdfPath: path.join(PITCH_DIR, "赢了就回家吃鱼生团队_民声智理_路演讲稿与演示动线.pdf"),
    title: "民声智理 — 路演讲稿与演示动线指南",
    subtitle: "路演答辩支撑 · 3/5分钟极速宣讲脚本",
  },
];

async function main() {
  console.log("🚀 开始生成最新全量 Pitch & 申报 PDF 材料...\n");
  const tempDir = path.join(ROOT, ".cache", "pdf-temps");
  fs.mkdirSync(tempDir, { recursive: true });

  for (const job of jobs) {
    if (!fs.existsSync(job.sourceMdPath)) {
      console.warn(`⚠️ 跳过不存在的源文件: ${job.sourceMdPath}`);
      continue;
    }

    const mdContent = fs.readFileSync(job.sourceMdPath, "utf8");
    const htmlContent = buildHtmlDocument(job.title, mdContent, job.subtitle);
    const tempHtmlPath = path.join(tempDir, `${path.basename(job.targetPdfPath, ".pdf")}.html`);
    fs.writeFileSync(tempHtmlPath, htmlContent, "utf8");

    console.log(`📄 正在生成: ${path.basename(job.targetPdfPath)} ...`);

    try {
      execFileSync(
        "wkhtmltopdf",
        [
          "--enable-local-file-access",
          "--encoding",
          "utf-8",
          "--page-size",
          "A4",
          "--margin-top",
          "16mm",
          "--margin-bottom",
          "16mm",
          "--margin-left",
          "14mm",
          "--margin-right",
          "14mm",
          "--footer-right",
          "第 [page] 页 / 共 [topage] 页",
          "--footer-font-size",
          "8",
          "--footer-spacing",
          "6",
          "--footer-font-name",
          "PingFang SC",
          tempHtmlPath,
          job.targetPdfPath,
        ],
        { stdio: "inherit" }
      );
      const st = fs.statSync(job.targetPdfPath);
      console.log(`✅ 成功: ${path.basename(job.targetPdfPath)} (${(st.size / 1024).toFixed(1)} KB)`);
    } catch (err) {
      console.error(`❌ 生成失败: ${job.targetPdfPath}`, err);
    }
  }

  console.log("\n✨ 全部最新 PDF 材料生成完毕！");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
