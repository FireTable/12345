import { NextRequest, NextResponse } from "next/server";
import { sql, getAllRegions } from "@/db/client";
import { registerRegion } from "@/lib/tenant/schema-manager";
import { invalidateVocabCache } from "@/lib/vocabulary";

/**
 * GET /api/admin/regions
 * 超管查看全量地区站点及各 Schema 的数据统计（工单数、多频主题数、字典数）
 */
export async function GET() {
  try {
    const regions = await getAllRegions();

    const statsList = await Promise.all(
      regions.map(async (r) => {
        try {
          const [tRow] = await sql.unsafe(
            `SELECT count(*)::int as count FROM "${r.schemaName}".tickets;`
          );
          const [thRow] = await sql.unsafe(
            `SELECT count(*)::int as count FROM "${r.schemaName}".themes;`
          );
          const [vRow] = await sql.unsafe(
            `SELECT count(*)::int as count FROM "${r.schemaName}".vocabularies;`
          );

          return {
            ...r,
            ticketCount: tRow?.count || 0,
            themeCount: thRow?.count || 0,
            vocabCount: vRow?.count || 0,
          };
        } catch (e) {
          return {
            ...r,
            ticketCount: 0,
            themeCount: 0,
            vocabCount: 0,
          };
        }
      })
    );

    return NextResponse.json({
      success: true,
      regions: statsList,
    });
  } catch (error: any) {
    console.error("[admin/regions] GET failed:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/regions
 * 超级管理员创建新地区 12345 站点
 * 自动在 PostgreSQL 物理创建 Schema 命名空间与 7 张标准数据表
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, name, city, province, svgMapPath, description, isDefault } = body;

    if (!id || !name || !city) {
      return NextResponse.json(
        { success: false, error: "缺少必要参数: id, name, city 为必填项" },
        { status: 400 }
      );
    }

    // 格式化标识符
    const cleanId = id.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
    const schemaName = `region_${cleanId}`;

    await registerRegion(sql, {
      id: cleanId,
      name: name.trim(),
      city: city.trim(),
      province: (province || "广东省").trim(),
      schemaName,
      svgMapPath: svgMapPath?.trim() || null,
      description: description?.trim() || null,
      isDefault: Boolean(isDefault),
    });

    invalidateVocabCache(cleanId);

    return NextResponse.json({
      success: true,
      message: `成功初始化地区站点 [${name}] 并创建 PostgreSQL Schema [${schemaName}]`,
      region: {
        id: cleanId,
        name,
        city,
        province: province || "广东省",
        schemaName,
        svgMapPath,
      },
    });
  } catch (error: any) {
    console.error("[admin/regions] POST failed:", error);
    return NextResponse.json(
      { success: false, error: error.message || "创建地区站点失败" },
      { status: 500 }
    );
  }
}
