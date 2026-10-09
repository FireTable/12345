/** 站点来源就够了。发现文档里的地址都从这次请求的 origin 拼出来。 */

export const MCP_PROTOCOL_VERSION = "2025-03-26";

export function mcpResourceUrl(origin: string): string {
  return `${origin}/api/mcp`;
}

export function protectedResourceMetadataUrl(origin: string): string {
  return `${origin}/.well-known/oauth-protected-resource`;
}

export function authorizationServerMetadataUrl(origin: string): string {
  return `${origin}/.well-known/oauth-authorization-server`;
}

export function wwwAuthenticate(origin: string): string {
  return `Bearer realm="12345", resource_metadata="${protectedResourceMetadataUrl(origin)}"`;
}

/** RFC 9728 */
export function protectedResourceMetadata(origin: string) {
  return {
    resource: mcpResourceUrl(origin),
    authorization_servers: [origin],
    bearer_methods_supported: ["header"],
    scopes_supported: ["mcp"],
    resource_name: "12345",
  };
}

/** RFC 8414。Better Auth 只负责人的登录，这里补授权服务器元数据。 */
export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/mcp/authorize`,
    token_endpoint: `${origin}/api/mcp/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
  };
}

export function requestOrigin(request: Request): string {
  return new URL(request.url).origin;
}

export function handleProtectedResourceMetadata(request: Request): Response {
  return Response.json(protectedResourceMetadata(requestOrigin(request)));
}

export function handleAuthorizationServerMetadata(request: Request): Response {
  return Response.json(authorizationServerMetadata(requestOrigin(request)));
}

export function unauthorizedResponse(origin: string): Response {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: {
      "WWW-Authenticate": wwwAuthenticate(origin),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
