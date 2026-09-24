import type { CivicPiiCategory } from "./types";

/**
 * 实体状态双向映射机 (Reversible State Tokenizer)
 *
 * 核心机制：
 * 1. 实体一致性去重 (Value Deduplication)：
 *    正文中多次出现的同一敏感实体（如多次提及同一违停车牌），始终绑定同一个 Token，
 *    避免大模型误以为现场存在多辆车或多个当事人。
 * 2. 状态连续性 (Cross-Stage SeedKeymap)：
 *    支持载入已有 Keymap，在多 Agent 协同与多轮对话中保证实体 Token 终身一致。
 * 3. 命名空间独立计数：
 *    各实体类别独立递增计数（如 LICENSE_PLATE_1, PHONE_NUMBER_1, ID_CARD_1）。
 */
export class Tokenizer {
  // Token (例如 {{LICENSE_PLATE_1}}) -> 真实值 (例如 鄂B 1JQ53)
  private keymap = new Map<string, string>();
  // 真实值 -> Token (用于防重复去重)
  private inverse = new Map<string, string>();
  // 各类别独立递增序号计数器
  private counters = new Map<string, number>();

  constructor(seedKeymap?: Record<string, string>) {
    if (seedKeymap && Object.keys(seedKeymap).length > 0) {
      this.loadKeymap(seedKeymap);
    }
  }

  /**
   * 将实体值转换为标准化占位符 Token（已存在则直接复用）
   */
  tokenize(
    value: string,
    category: CivicPiiCategory,
    bracketStyle: "double-curly" | "unicode-bracket" = "double-curly"
  ): string {
    // 1. 去重防护：若该实体之前已分配过 Token，直接复用已有 Token
    const existing = this.inverse.get(value);
    if (existing) {
      return existing;
    }

    // 2. 独立分类自增计数
    const currentCount = (this.counters.get(category) ?? 0) + 1;
    this.counters.set(category, currentCount);

    const tokenName = `${category}_${currentCount}`;
    const token =
      bracketStyle === "unicode-bracket" ? `⟦${tokenName}⟧` : `{{${tokenName}}}`;

    this.inverse.set(value, token);
    this.keymap.set(token, value);
    return token;
  }

  /**
   * 载入历史 Keymap，继承跨阶段实体代号与计数状态
   */
  loadKeymap(seed: Record<string, string>): void {
    for (const [token, value] of Object.entries(seed)) {
      this.keymap.set(token, value);
      this.inverse.set(value, token);

      // 解析已有 Token 中的最大数字编号，防止后续新增实体编号冲突
      const match = token.match(/([A-Z_]+)_(\d+)/);
      if (match) {
        const cat = match[1];
        const num = parseInt(match[2], 10);
        const currentMax = this.counters.get(cat) ?? 0;
        if (num > currentMax) {
          this.counters.set(cat, num);
        }
      }
    }
  }

  /**
   * 导出本次会话的全量映射字典
   */
  getKeymap(): Record<string, string> {
    return Object.fromEntries(this.keymap);
  }
}
