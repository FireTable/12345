import fs from "fs";
import path from "path";

interface MatchItem {
  file: string;
  line: number;
  content: string;
  category: "TEMPLATE_CONCAT" | "PROMPT" | "FALLBACK" | "RULE_LOGIC" | "PRESET_DICT" | "OTHER";
}

const EXCLUDE_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "dist",
  "build",
  "public",
  "coverage",
]);

const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);
const CHINESE_REGEX = /[\u4e00-\u9fa5]/;

function categorize(content: string, filePath: string): MatchItem["category"] {
  if (content.includes("prompt") || content.includes("Prompt") || content.includes("HumanMessage") || content.includes("SystemMessage") || content.includes("你是中国") || content.includes("分析以下")) {
    return "PROMPT";
  }
  if (filePath.includes("presets") || filePath.includes("vocabulary.ts") && content.includes("name:")) {
    return "PRESET_DICT";
  }
  if ((content.includes("`") && content.includes("${")) || (content.includes("+") && content.includes('"'))) {
    return "TEMPLATE_CONCAT";
  }
  if (content.includes("includes(") || content.includes("test(") || content.includes("match(") || content.includes("===") || content.includes("!==")) {
    return "RULE_LOGIC";
  }
  if (content.includes("||") || content.includes("??") || content.includes("default") || content.includes("Default")) {
    return "FALLBACK";
  }
  return "OTHER";
}

function scanDir(dir: string, results: MatchItem[]) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      scanDir(path.join(dir, entry.name), results);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (!EXTENSIONS.has(ext)) continue;
      if (entry.name.startsWith("scan-chinese")) continue;
      scanFile(path.join(dir, entry.name), results);
    }
  }
}

function scanFile(filePath: string, results: MatchItem[]) {
  const content = fs.readFileSync(filePath, "utf-8");

  // Remove multi-line comments /* ... */ while preserving line count
  const withoutBlockComments = content.replace(/\/\*[\s\S]*?\*\//g, (match) => {
    return "\n".repeat((match.match(/\n/g) || []).length);
  });

  const lines = withoutBlockComments.split("\n");

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Remove single-line comment // ...
    const commentIdx = line.indexOf("//");
    if (commentIdx !== -1) {
      line = line.substring(0, commentIdx);
    }

    // Remove JSX comments {/* ... */}
    line = line.replace(/\{\/\*[\s\S]*?\/\}/g, "");

    const trimmed = line.trim();
    if (!trimmed) continue;

    if (CHINESE_REGEX.test(trimmed)) {
      const relPath = path.relative(process.cwd(), filePath);
      results.push({
        file: relPath,
        line: i + 1,
        content: trimmed,
        category: categorize(trimmed, relPath),
      });
    }
  }
}

function main() {
  // We scan backend, lib, and app/api
  const targets = ["backend", "lib", "app/api"];
  const allResults: MatchItem[] = [];

  for (const target of targets) {
    const fullPath = path.resolve(process.cwd(), target);
    if (fs.existsSync(fullPath)) {
      scanDir(fullPath, allResults);
    }
  }

  // Generate markdown report
  let md = `# 项目非注释代码中文审查全景报告\n\n`;
  md += `> 本报告由 \`scripts/scan-chinese.ts\` 自动生成，已过滤掉全部单行注释 (\`//\`)、块级注释 (\`/* ... */\`) 与 JSX 注释。\n\n`;
  md += `## 📊 统计汇总\n`;
  md += `- **扫描目录**: \`backend/\`, \`lib/\`, \`app/api/\`\n`;
  md += `- **涉及代码文件数**: ${new Set(allResults.map((r) => r.file)).size} 个\n`;
  md += `- **含非注释中文代码行**: ${allResults.length} 行\n\n`;

  const categoryLabels: Record<MatchItem["category"], string> = {
    TEMPLATE_CONCAT: "🧩 中文拼装模板（字符串插值 / 拼接）",
    RULE_LOGIC: "⚙️ 规则与判断死逻辑（正则 / includes / 枚举分支）",
    FALLBACK: "🛡️ 默认兜底中文（|| / ?? / 缺省值）",
    PROMPT: "🤖 AI 提示词与大模型指令（Prompt）",
    PRESET_DICT: "📚 预置字典与标准基础数据",
    OTHER: "📝 其他常规中文字符串常量/API响应",
  };

  const byCat = new Map<MatchItem["category"], MatchItem[]>();
  for (const item of allResults) {
    if (!byCat.has(item.category)) byCat.set(item.category, []);
    byCat.get(item.category)!.push(item);
  }

  md += `### 分类分布\n\n`;
  md += `| 类别 | 描述 | 出现行数 | 建议治理方案 |\n`;
  md += `| :--- | :--- | :--- | :--- |\n`;
  md += `| **中文拼装模板** | 字符串插值拼接（如 \`微观地点【\${loc}】...集中出现\`） | ${byCat.get("TEMPLATE_CONCAT")?.length || 0} 行 | 彻底交由 LLM 或动态模板引擎生成，消除写死句式 |\n`;
  md += `| **规则与判断逻辑** | 包含特定中文词的 \`includes\` / 正则分支 | ${byCat.get("RULE_LOGIC")?.length || 0} 行 | 移除特定词死判断，改为纯数据驱动或模型抽取 |\n`;
  md += `| **默认兜底中文** | 缺省回退词（如 \`|| "城市管理"\`, \`|| "热线市民"\`） | ${byCat.get("FALLBACK")?.length || 0} 行 | 动态回退到当前站点的 \`vocab.categories[0]\` |\n`;
  md += `| **AI 提示词** | 引导大模型的 Prompt 模板与 Few-Shot | ${byCat.get("PROMPT")?.length || 0} 行 | 保留或放入提示词配置中心，地名注入动态变量 |\n`;
  md += `| **预置字典数据** | 默认顺德/广州预置区划字典 | ${byCat.get("PRESET_DICT")?.length || 0} 行 | 移至数据库与独立 JSON 种子文件维护 |\n`;
  md += `| **其他常量与消息** | API 返回文案与状态码说明 | ${byCat.get("OTHER")?.length || 0} 行 | 统一收拢到 \`lib/api-codes.ts\` |\n\n`;

  // Section 1: Focus on Template Concatenation (user specifically pointed this out)
  const templateItems = byCat.get("TEMPLATE_CONCAT") || [];
  md += `## 一、重点排查：中文拼装与硬编码生成逻辑 (${templateItems.length} 处)\n\n`;
  md += `> 用户重点关注的 \`微观点位群发\`、\`建议属地综合行政执法队...\` 等字符串拼装集中于此：\n\n`;

  const templateGrouped = new Map<string, MatchItem[]>();
  for (const t of templateItems) {
    if (!templateGrouped.has(t.file)) templateGrouped.set(t.file, []);
    templateGrouped.get(t.file)!.push(t);
  }
  for (const [file, items] of templateGrouped.entries()) {
    md += `#### \`${file}\`\n\`\`\`typescript\n`;
    for (const item of items) {
      md += `L${item.line}: ${item.content}\n`;
    }
    md += `\`\`\`\n\n`;
  }

  // Section 2: Rule logic
  const ruleItems = byCat.get("RULE_LOGIC") || [];
  md += `## 二、重点排查：规则与判断死逻辑 (${ruleItems.length} 处)\n\n`;
  const ruleGrouped = new Map<string, MatchItem[]>();
  for (const t of ruleItems) {
    if (!ruleGrouped.has(t.file)) ruleGrouped.set(t.file, []);
    ruleGrouped.get(t.file)!.push(t);
  }
  for (const [file, items] of ruleGrouped.entries()) {
    md += `#### \`${file}\`\n\`\`\`typescript\n`;
    for (const item of items) {
      md += `L${item.line}: ${item.content}\n`;
    }
    md += `\`\`\`\n\n`;
  }

  // Section 3: Fallbacks
  const fallbackItems = byCat.get("FALLBACK") || [];
  md += `## 三、默认兜底与回退中文 (${fallbackItems.length} 处)\n\n`;
  const fallbackGrouped = new Map<string, MatchItem[]>();
  for (const t of fallbackItems) {
    if (!fallbackGrouped.has(t.file)) fallbackGrouped.set(t.file, []);
    fallbackGrouped.get(t.file)!.push(t);
  }
  for (const [file, items] of fallbackGrouped.entries()) {
    md += `#### \`${file}\`\n\`\`\`typescript\n`;
    for (const item of items) {
      md += `L${item.line}: ${item.content}\n`;
    }
    md += `\`\`\`\n\n`;
  }

  const outReportPath = path.resolve(process.cwd(), "scripts/chinese-audit-report.md");
  fs.writeFileSync(outReportPath, md, "utf-8");
  console.log(`\n✅ 审查报告已生成至: ${outReportPath}`);
}

main();
