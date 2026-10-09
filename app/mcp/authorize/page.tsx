"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

export default function McpAuthorizePage() {
  const [name, setName] = useState("MCP client");
  const [redirectUri, setRedirectUri] = useState("");
  const [state, setState] = useState("");
  const [codeChallenge, setCodeChallenge] = useState("");
  const [responseType, setResponseType] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    setName(query.get("client_name") || query.get("name") || "MCP client");
    setRedirectUri(query.get("redirect_uri") || "");
    setState(query.get("state") || "");
    setCodeChallenge(query.get("code_challenge") || "");
    setResponseType(query.get("response_type") || "");
  }, []);

  async function approve() {
    setPending(true);
    try {
      const res = await fetch("/api/mcp/grant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          redirectUri: redirectUri || undefined,
          codeChallenge: codeChallenge || undefined,
          responseType: responseType || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        toast.error(data.message || data.error || "授权失败");
        setPending(false);
        return;
      }
      if (data.data?.code && redirectUri) {
        const next = new URL(redirectUri);
        next.searchParams.set("code", data.data.code);
        if (state) next.searchParams.set("state", state);
        window.location.assign(next.toString());
        return;
      }
      setToken(data.data?.accessToken || "");
    } catch {
      toast.error("授权请求失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl px-6 py-10">
      <div className="page-hero">
        <div>
          <div className="page-hero__title">授权接入 12345</div>
          <div className="page-hero__desc">
            当前登录身份将签发一把 access key。Agent 用它查询地区、写入工单、读取治理总览。可在站点管理中心吊销。
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
        <div className="text-xs text-slate-500">客户端</div>
        <div className="mt-1 text-sm font-semibold text-slate-900">{name}</div>
        {redirectUri ? (
          <div className="mt-3 text-xs text-slate-500">
            同意后回到 <span className="font-mono text-slate-700">{redirectUri}</span>
          </div>
        ) : null}

        {token ? (
          <div className="mt-5">
            <div className="text-xs text-slate-500">access token（只显示这一次）</div>
            <textarea
              readOnly
              value={token}
              className="mt-2 w-full rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-800"
              rows={4}
            />
          </div>
        ) : (
          <button
            type="button"
            className="btn btn--primary mt-5 h-[34px] px-3.5 text-xs font-medium"
            onClick={approve}
            disabled={pending}
          >
            {pending ? "正在签发" : "授权并获取 access token"}
          </button>
        )}
      </div>
    </div>
  );
}
