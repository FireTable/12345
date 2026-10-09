import { handleAuthorizationServerMetadata } from "@/lib/mcp/discovery";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return handleAuthorizationServerMetadata(request);
}
