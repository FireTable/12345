import { exchangeMcpAuthorizationCode } from "@/lib/mcp/clients";

export const dynamic = "force-dynamic";

async function readTokenForm(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = (await request.json()) as Record<string, string>;
    return {
      grantType: body.grant_type || "",
      code: body.code || "",
      redirectUri: body.redirect_uri || "",
      codeVerifier: body.code_verifier || "",
    };
  }
  const form = await request.formData();
  return {
    grantType: String(form.get("grant_type") || ""),
    code: String(form.get("code") || ""),
    redirectUri: String(form.get("redirect_uri") || ""),
    codeVerifier: String(form.get("code_verifier") || ""),
  };
}

export async function POST(request: Request) {
  const form = await readTokenForm(request);
  if (form.grantType !== "authorization_code" || !form.code || !form.redirectUri) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  const issued = await exchangeMcpAuthorizationCode({
    code: form.code,
    redirectUri: form.redirectUri,
    codeVerifier: form.codeVerifier,
  });
  if (!issued) return Response.json({ error: "invalid_grant" }, { status: 400 });
  return Response.json({
    access_token: issued.accessToken,
    token_type: "Bearer",
  });
}
