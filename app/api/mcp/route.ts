import { handleMcpHttp } from "@/lib/mcp/http";

export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return handleMcpHttp(request);
}

export function GET(request: Request) {
  return handleMcpHttp(request);
}
