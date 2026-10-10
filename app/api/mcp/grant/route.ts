import { auth } from "@/lib/auth/config";
import { ApiCode, apiError, apiSuccess } from "@/lib/api-codes";
import { issueMcpAuthorizationCode, issueMcpClient } from "@/lib/mcp/clients";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    const userId = session?.user?.id;
    if (!userId) return apiError(ApiCode.UNAUTHORIZED, "请先登录后再授权", 401);

    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      redirectUri?: string;
      codeChallenge?: string;
      responseType?: string;
    };
    const name = String(body.name || "").trim() || "MCP client";

    if (body.responseType === "code") {
      const redirectUri = String(body.redirectUri || "");
      if (!/^https?:\/\//i.test(redirectUri)) {
        return apiError(ApiCode.INVALID_PARAMS, "回调地址必须是 http 或 https", 400);
      }
      const code = await issueMcpAuthorizationCode({
        userId,
        name,
        redirectUri,
        codeChallenge: body.codeChallenge,
      });
      return apiSuccess({ code });
    }

    const issued = await issueMcpClient({ userId, name });
    return apiSuccess({ accessToken: issued.accessToken, client: issued.client });
  } catch (error) {
    console.error("[api/mcp/grant] Error:", error);
    return apiError(ApiCode.INTERNAL_ERROR, error instanceof Error ? error.message : "授权失败", 500);
  }
}
