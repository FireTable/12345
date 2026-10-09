import { createHash, randomBytes } from "node:crypto";
import { sql } from "@/db/client";
import { auth } from "@/lib/auth/config";

export type McpClientView = {
  id: string;
  name: string;
  userId: string;
  userName: string;
  userEmail: string;
  username: string;
  createdAt: string;
  lastUsedAt: string | null;
};

export type IssuedMcpClient = {
  accessToken: string;
  client: McpClientView;
};

type ClientRow = {
  id: string;
  name: string;
  user_id: string;
  user_name: string | null;
  user_email: string | null;
  username: string | null;
  created_at: Date | string;
  last_used_at: Date | string | null;
};

let ready: Promise<void> | null = null;

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function asIso(value: Date | string | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toView(row: ClientRow): McpClientView {
  return {
    id: row.id,
    name: row.name,
    userId: row.user_id,
    userName: row.user_name || "",
    userEmail: row.user_email || "",
    username: row.username || "",
    createdAt: asIso(row.created_at) || "",
    lastUsedAt: asIso(row.last_used_at),
  };
}

export function ensureMcpTables(): Promise<void> {
  ready ??= (async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS public.mcp_clients (
        id text PRIMARY KEY,
        name text NOT NULL,
        user_id text NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
        token_hash text NOT NULL UNIQUE,
        created_at timestamptz NOT NULL DEFAULT now(),
        revoked_at timestamptz,
        last_used_at timestamptz
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_mcp_clients_user ON public.mcp_clients (user_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_mcp_clients_token_hash ON public.mcp_clients (token_hash)`;
    await sql`
      CREATE TABLE IF NOT EXISTS public.mcp_auth_codes (
        code_hash text PRIMARY KEY,
        client_name text NOT NULL,
        user_id text NOT NULL,
        redirect_uri text NOT NULL,
        code_challenge text,
        expires_at timestamptz NOT NULL,
        used_at timestamptz
      )
    `;
  })();
  return ready;
}

function clientById(id: string) {
  return sql<ClientRow[]>`
    SELECT c.id, c.name, c.user_id, u.name AS user_name, u.email AS user_email,
           u.username, c.created_at, c.last_used_at
    FROM public.mcp_clients c
    JOIN public."user" u ON u.id = c.user_id
    WHERE c.id = ${id}
  `;
}

export async function issueMcpClient(input: { userId: string; name: string }): Promise<IssuedMcpClient> {
  await ensureMcpTables();
  const id = `mcp_${randomBytes(12).toString("base64url")}`;
  const accessToken = `civic_${randomBytes(32).toString("base64url")}`;
  const name = input.name.trim() || "MCP client";
  await sql`
    INSERT INTO public.mcp_clients (id, name, user_id, token_hash)
    VALUES (${id}, ${name}, ${input.userId}, ${sha256Hex(accessToken)})
  `;
  const [row] = await clientById(id);
  if (!row) throw new Error("签发后没有读到客户端");
  return { accessToken, client: toView(row) };
}

export async function authorizeMcpClientFromHeaders(
  headerSource: Headers,
  clientName: string
): Promise<IssuedMcpClient | null> {
  const session = await auth.api.getSession({ headers: headerSource });
  const userId = session?.user?.id;
  if (!userId) return null;
  return issueMcpClient({ userId, name: clientName });
}

export async function listMcpClients(): Promise<McpClientView[]> {
  await ensureMcpTables();
  const rows = await sql<ClientRow[]>`
    SELECT c.id, c.name, c.user_id, u.name AS user_name, u.email AS user_email,
           u.username, c.created_at, c.last_used_at
    FROM public.mcp_clients c
    JOIN public."user" u ON u.id = c.user_id
    WHERE c.revoked_at IS NULL
    ORDER BY c.created_at DESC
  `;
  return rows.map(toView);
}

/** 站点管理中心吊销走这个函数。吊销后原 token 不能再调用。 */
export async function revokeMcpClient(id: string): Promise<boolean> {
  await ensureMcpTables();
  const rows = await sql<{ id: string }[]>`
    UPDATE public.mcp_clients
    SET revoked_at = now()
    WHERE id = ${id} AND revoked_at IS NULL
    RETURNING id
  `;
  return rows.length > 0;
}

export async function verifyMcpAccessToken(token: string): Promise<McpClientView | null> {
  if (!token) return null;
  await ensureMcpTables();
  const rows = await sql<ClientRow[]>`
    SELECT c.id, c.name, c.user_id, u.name AS user_name, u.email AS user_email,
           u.username, c.created_at, c.last_used_at
    FROM public.mcp_clients c
    JOIN public."user" u ON u.id = c.user_id
    WHERE c.token_hash = ${sha256Hex(token)} AND c.revoked_at IS NULL
  `;
  const row = rows[0];
  if (!row) return null;
  await sql`UPDATE public.mcp_clients SET last_used_at = now() WHERE id = ${row.id}`;
  return toView(row);
}

function s256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export async function issueMcpAuthorizationCode(input: {
  userId: string;
  name: string;
  redirectUri: string;
  codeChallenge?: string | null;
}): Promise<string> {
  await ensureMcpTables();
  const code = `civic_code_${randomBytes(24).toString("base64url")}`;
  const expires = new Date(Date.now() + 10 * 60 * 1000);
  await sql`
    INSERT INTO public.mcp_auth_codes (code_hash, client_name, user_id, redirect_uri, code_challenge, expires_at)
    VALUES (
      ${sha256Hex(code)},
      ${input.name.trim() || "MCP client"},
      ${input.userId},
      ${input.redirectUri},
      ${input.codeChallenge || null},
      ${expires}
    )
  `;
  return code;
}

export async function exchangeMcpAuthorizationCode(input: {
  code: string;
  redirectUri: string;
  codeVerifier?: string | null;
}): Promise<IssuedMcpClient | null> {
  await ensureMcpTables();
  const rows = await sql<
    Array<{
      client_name: string;
      user_id: string;
      redirect_uri: string;
      code_challenge: string | null;
    }>
  >`
    SELECT client_name, user_id, redirect_uri, code_challenge
    FROM public.mcp_auth_codes
    WHERE code_hash = ${sha256Hex(input.code)}
      AND used_at IS NULL
      AND expires_at > now()
  `;
  const row = rows[0];
  if (!row || row.redirect_uri !== input.redirectUri) return null;
  if (row.code_challenge) {
    if (!input.codeVerifier || s256(input.codeVerifier) !== row.code_challenge) return null;
  }
  await sql`
    UPDATE public.mcp_auth_codes
    SET used_at = now()
    WHERE code_hash = ${sha256Hex(input.code)} AND used_at IS NULL
  `;
  return issueMcpClient({ userId: row.user_id, name: row.client_name });
}
