import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { vocabulariesTable, aliasesTable, type AliasRecord, type VocabularyRecord } from "@/db/schema";
import { eq, desc, ilike, or, count } from "drizzle-orm";
import { normalizeAliasesInText, registerAlias, getAllAliases } from "@/lib/alias-dict";
import { SHUNDE_TOWNSHIPS, STANDARD_CATEGORIES } from "@/lib/vocabulary";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") || "").trim();
    const type = (searchParams.get("type") || "").trim();

    let aliases: AliasRecord[] = [];
    let vocabularies: VocabularyRecord[] = [];

    // 1. 查询别名库
    try {
      let query = db.select().from(aliasesTable).orderBy(desc(aliasesTable.createdAt));
      if (q) {
        aliases = await db
          .select()
          .from(aliasesTable)
          .where(or(ilike(aliasesTable.alias, `%${q}%`), ilike(aliasesTable.canonical, `%${q}%`)))
          .orderBy(desc(aliasesTable.createdAt));
      } else {
        aliases = await query;
      }
    } catch (e) {
      // 内存兜底
      const memAliases = getAllAliases();
      aliases = Object.entries(memAliases).map(([alias, canonical], i) => ({
        id: `ALIAS-${i + 1}`,
        alias,
        canonical,
        type: canonical.endsWith("街道") || canonical.endsWith("镇") ? "TOWNSHIP" : "ENTITY",
        source: "PRESET",
        usageCount: 0,
        createdAt: new Date(),
      }));
    }

    // 2. 查询标准词汇库
    try {
      if (type) {
        vocabularies = await db
          .select()
          .from(vocabulariesTable)
          .where(eq(vocabulariesTable.type, type))
          .orderBy(vocabulariesTable.id);
      } else {
        vocabularies = await db.select().from(vocabulariesTable).orderBy(vocabulariesTable.id);
      }
    } catch (e) {
      vocabularies = [];
    }

    const stats = {
      townshipCount: SHUNDE_TOWNSHIPS.length,
      categoryCount: STANDARD_CATEGORIES.length,
      aliasCount: aliases.length,
      communityCount: vocabularies.filter((v) => v.type === "COMMUNITY").length || 98,
    };

    return NextResponse.json({
      success: true,
      stats,
      townships: SHUNDE_TOWNSHIPS,
      categories: STANDARD_CATEGORIES,
      aliases,
      vocabularies,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "Failed to fetch dictionary" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;

    // 1. 实时测试别名替换
    if (action === "test_replace") {
      const text = String(body.text || "");
      const normalized = normalizeAliasesInText(text);
      return NextResponse.json({
        success: true,
        original: text,
        normalized,
      });
    }

    // 2. 新增或更新别名
    if (action === "add_alias") {
      const { alias, canonical, type } = body;
      if (!alias || !canonical) {
        return NextResponse.json(
          { success: false, error: "别名与规范名称均不能为空" },
          { status: 400 }
        );
      }

      const cleanAlias = String(alias).trim();
      const cleanCanonical = String(canonical).trim();
      const aliasType = type || (cleanCanonical.endsWith("街道") || cleanCanonical.endsWith("镇") ? "TOWNSHIP" : "ENTITY");

      // 注册到内存引擎
      registerAlias(cleanAlias, cleanCanonical);

      // 写入数据库
      try {
        await db
          .insert(aliasesTable)
          .values({
            id: `ALIAS-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            alias: cleanAlias,
            canonical: cleanCanonical,
            type: aliasType,
            source: "MANUAL",
            usageCount: 0,
          })
          .onConflictDoUpdate({
            target: aliasesTable.alias,
            set: {
              canonical: cleanCanonical,
              type: aliasType,
            },
          });
      } catch (e) {}

      return NextResponse.json({ success: true, message: "别名添加成功" });
    }

    // 3. 删除别名
    if (action === "delete_alias") {
      const { id, alias } = body;
      if (id) {
        await db.delete(aliasesTable).where(eq(aliasesTable.id, id));
      } else if (alias) {
        await db.delete(aliasesTable).where(eq(aliasesTable.alias, alias));
      }
      return NextResponse.json({ success: true, message: "别名已删除" });
    }

    return NextResponse.json({ success: false, error: "Unknown action" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "Operation failed" },
      { status: 500 }
    );
  }
}
