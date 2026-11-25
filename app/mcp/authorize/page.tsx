"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Copy, AlertCircle } from "lucide-react";
import { toast } from "sonner";

function isAllowedRedirectUri(raw: string): boolean {
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === "https:") return true;
    if (
      parsed.protocol === "http:" &&
      (parsed.hostname === "localhost" ||
        parsed.hostname === "127.0.0.1" ||
        parsed.hostname === "[::1]")
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function legacyCopyText(text: string): boolean {
  const previousFocus = document.activeElement as HTMLElement | null;
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.cssText = "position:fixed;inset-block-start:0;opacity:0";
  document.body.append(field);
  field.select();
  try {
    return document.execCommand("copy");
  } finally {
    field.remove();
    previousFocus?.focus({ preventScroll: true });
  }
}

export default function McpAuthorizePage() {
  const [name, setName] = useState("MCP client");
  const [redirectUri, setRedirectUri] = useState("");
  const [state, setState] = useState("");
  const [codeChallenge, setCodeChallenge] = useState("");
  const [responseType, setResponseType] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [copyAnnouncement, setCopyAnnouncement] = useState("");
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAnnouncementRef = useRef("");

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    setName(query.get("client_name") || query.get("name") || "MCP client");
    setRedirectUri(query.get("redirect_uri") || "");
    setState(query.get("state") || "");
    setCodeChallenge(query.get("code_challenge") || "");
    setResponseType(query.get("response_type") || "");
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const hasRedirect = Boolean(redirectUri.trim());
  const redirectValid = !hasRedirect || isAllowedRedirectUri(redirectUri.trim());

  async function approve() {
    setErrorMsg("");
    if (hasRedirect && !redirectValid) {
      setErrorMsg("回调地址不安全：仅允许 https:// 或本机 http://localhost / http://127.0.0.1。");
      return;
    }
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
        const msg = data.message || data.error || "授权失败";
        setErrorMsg(msg);
        setPending(false);
        return;
      }
      if (data.data?.code && redirectUri) {
        if (!isAllowedRedirectUri(redirectUri.trim())) {
          setErrorMsg("回调地址校验未通过，已中止自动跳转。");
          setPending(false);
          return;
        }
        const next = new URL(redirectUri);
        next.searchParams.set("code", data.data.code);
        if (state) next.searchParams.set("state", state);
        window.location.assign(next.toString());
        return;
      }
      setToken(data.data?.accessToken || "");
    } catch {
      setErrorMsg("授权请求失败，请检查登录状态或网络连接。");
    } finally {
      setPending(false);
    }
  }

  async function copyToken() {
    if (!token) return;
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(token);
        ok = true;
      } else {
        ok = legacyCopyText(token);
      }
    } catch {
      ok = legacyCopyText(token);
    }

    const baseMsg = ok ? "已复制 Access Token" : "复制失败，请手动选中复制";
    const msg = baseMsg === lastAnnouncementRef.current ? `${baseMsg}\u00A0` : baseMsg;
    lastAnnouncementRef.current = msg;
    setCopyState(ok ? "copied" : "failed");
    setCopyAnnouncement(msg);
    if (ok) {
      toast.success("已复制 Access Token");
    } else {
      toast.error("复制失败，请手动选中复制");
    }
    copyTimerRef.current = setTimeout(() => {
      setCopyState("idle");
      setCopyAnnouncement("");
    }, 2200);
  }

  return (
    <div className="mx-auto max-w-xl px-4 sm:px-6 py-8 sm:py-10">
      <div className="page-hero">
        <div>
          <h1 className="page-hero__title">授权接入 12345 MCP</h1>
          <p className="page-hero__desc text-sm text-slate-600 mt-1">
            当前登录身份将签发一把 access key，供 Agent 查询地区、写入工单与读取治理总览，可随时在管理中心吊销。
          </p>
        </div>
        <div className="page-hero__actions shrink-0">
          <Link
            href="/"
            className="btn btn--default min-h-[44px] px-4 text-sm inline-flex items-center justify-center"
          >
            返回首页
          </Link>
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-2xs space-y-4">
        <div>
          <div className="text-[13px] font-medium text-slate-500">申请接入客户端</div>
          <div className="mt-1 text-base font-semibold text-slate-900">{name}</div>
        </div>

        {hasRedirect ? (
          <div
            className={`rounded-lg px-3 py-2.5 text-[13px] ${
              redirectValid ? "bg-slate-50 text-slate-700" : "bg-rose-50 text-rose-800 border border-rose-200"
            }`}
          >
            <div>
              OAuth 回调模式：同意授权后将携带临时授权码跳转至{" "}
              <span className="tabular-nums break-all font-medium text-slate-900">{redirectUri}</span>
            </div>
            {!redirectValid ? (
              <p className="mt-1 font-medium text-rose-700">
                回调地址协议受限：仅支持 https:// 或本地 http://localhost / http://127.0.0.1。
              </p>
            ) : null}
          </div>
        ) : (
          <div className="rounded-lg bg-slate-50 px-3 py-2.5 text-[13px] text-slate-600">
            手动签发模式：当前未携带 <span className="font-medium text-slate-800">redirect_uri</span> 参数，授权后将在本页一次性生成 Access Token 供复制配置；若由支持 OAuth 的客户端唤起，将自动附带回调地址回跳。
          </div>
        )}

        {errorMsg ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-[13px] text-rose-800"
          >
            <AlertCircle size={16} aria-hidden="true" className="shrink-0 mt-0.5 text-rose-600" />
            <span>{errorMsg}</span>
          </div>
        ) : null}

        {token ? (
          <div className="space-y-3 pt-1">
            <div>
              <label htmlFor="mcp-access-token" className="block text-[13px] font-medium text-slate-700">
                Access Token（仅本次显示，请及时保存）
              </label>
              <textarea
                id="mcp-access-token"
                readOnly
                value={token}
                className="mt-2 w-full rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-900 tabular-nums break-all"
                rows={4}
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void copyToken()}
                className="btn btn--primary min-h-[44px] px-4 text-sm font-medium inline-flex items-center gap-2"
              >
                {copyState === "copied" ? (
                  <Check size={16} aria-hidden="true" />
                ) : (
                  <Copy size={16} aria-hidden="true" />
                )}
                <span>{copyState === "copied" ? "已复制 Token" : "一键复制 Token"}</span>
              </button>
              <Link
                href="/"
                className="btn btn--default min-h-[44px] px-4 text-sm inline-flex items-center justify-center"
              >
                返回首页
              </Link>
              <span role="status" aria-live="polite" className="text-[13px] text-slate-600">
                {copyAnnouncement}
              </span>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="button"
              className="btn btn--primary min-h-[44px] px-4 text-sm font-medium"
              onClick={() => void approve()}
              disabled={pending || !redirectValid}
            >
              {pending ? "正在签发…" : "授权并获取 access token"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
