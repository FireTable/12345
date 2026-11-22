import { NextResponse } from "next/server";
import { guardAgentRequest } from "@/lib/security/agent-guard";
import { resolveRequestRegionId } from "@/lib/tenant/request-region";
import { submitCitizenTicket } from "@/lib/agent-governance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const guard = await guardAgentRequest(req, {
      role: "any",
      scope: "intake-submit",
      maxPerMinute: 15,
    });
    if ("response" in guard) return guard.response;

    const body = (await req.json().catch(() => null)) as {
      title?: unknown;
      content?: unknown;
      subdistrict?: unknown;
      category?: unknown;
      subject?: unknown;
      address?: unknown;
      contactPhone?: unknown;
      contactEmail?: unknown;
      source?: unknown;
      skipAutoCluster?: unknown;
      regionId?: unknown;
    } | null;

    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { success: false, code: "BAD_REQUEST", error: "无效的请求体" },
        { status: 400 }
      );
    }

    const content = typeof body.content === "string" ? body.content.trim() : "";
    const subdistrict = typeof body.subdistrict === "string" ? body.subdistrict.trim() : "";
    const category = typeof body.category === "string" ? body.category.trim() : "";
    const contactPhone = typeof body.contactPhone === "string" ? body.contactPhone.trim() : "";
    const contactEmail = typeof body.contactEmail === "string" ? body.contactEmail.trim() : "";

    if (content.length < 6) {
      return NextResponse.json(
        {
          success: false,
          code: "INVALID_PARAMS",
          error: "诉求内容至少需要 6 个字，请补充完整描述",
        },
        { status: 400 }
      );
    }
    if (!subdistrict) {
      return NextResponse.json(
        {
          success: false,
          code: "INVALID_PARAMS",
          error: "请选择所属镇街或渠道/仓网",
        },
        { status: 400 }
      );
    }
    if (!category) {
      return NextResponse.json(
        {
          success: false,
          code: "INVALID_PARAMS",
          error: "请选择诉求或客诉分类",
        },
        { status: 400 }
      );
    }

    const normalizedPhone = contactPhone.replace(/[\s-]/g, "");
    const phoneOk =
      !contactPhone ||
      /^1[3-9]\d{9}$/.test(normalizedPhone) ||
      /^0\d{2,3}-?\d{7,8}$/.test(contactPhone.replace(/\s+/g, ""));
    if (!phoneOk) {
      return NextResponse.json(
        {
          success: false,
          code: "INVALID_PARAMS",
          error: "联系电话格式不正确，请输入 11 位手机号或区号座机",
        },
        { status: 400 }
      );
    }

    const emailOk = !contactEmail || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail);
    if (!emailOk) {
      return NextResponse.json(
        {
          success: false,
          code: "INVALID_PARAMS",
          error: "电子邮箱格式不正确，请核对后重试",
        },
        { status: 400 }
      );
    }

    if (!contactPhone && !contactEmail) {
      return NextResponse.json(
        {
          success: false,
          code: "INVALID_PARAMS",
          error: "请至少填写联系电话或电子邮箱，以便工作人员跟进回访",
        },
        { status: 400 }
      );
    }

    const regionId = await resolveRequestRegionId(
      req,
      typeof body.regionId === "string" ? body.regionId : undefined
    );

    const result = await submitCitizenTicket({
      regionId,
      userId: guard.session.user.id,
      userName: guard.session.user.name || guard.session.user.username || "市民用户",
      title: typeof body.title === "string" ? body.title : undefined,
      content,
      subdistrict,
      category,
      subject: typeof body.subject === "string" ? body.subject : undefined,
      address: typeof body.address === "string" ? body.address : undefined,
      contactPhone: contactPhone || undefined,
      contactEmail: contactEmail || undefined,
      source: body.source === "AGENT_VOICE" ? "AGENT_VOICE" : "FORM",
      skipAutoCluster: body.skipAutoCluster === true,
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to submit ticket";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
