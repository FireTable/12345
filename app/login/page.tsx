"use client";

import { useState, useTransition, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ShieldCheck,
  Lock,
  User,
  Sparkles,
  Building2,
  Eye,
  EyeOff,
  Zap,
  Layers,
  Activity,
} from "lucide-react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth/client";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams.get("from") || "/";

  const [account, setAccount] = useState("admin");
  const [password, setPassword] = useState("admin");
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!account.trim() || !password.trim()) {
      setErrorMessage("请输入账号和密码");
      return;
    }

    setErrorMessage("");

    startTransition(async () => {
      try {
        const isEmail = account.includes("@");
        const res = isEmail
          ? await authClient.signIn.email({
              email: account.trim(),
              password: password.trim(),
            })
          : await authClient.signIn.username({
              username: account.trim(),
              password: password.trim(),
            });

        if (res.error) {
          const msg =
            res.error.message === "Invalid email or password" ||
            res.error.message === "Invalid username or password"
              ? "账号或密码错误，请检查后重试"
              : res.error.message || "登录失败，请稍后重试";
          setErrorMessage(msg);
          toast.error(msg);
          return;
        }

        toast.success("验证成功，正在进入工作台...");
        window.location.href = from;
      } catch (err: any) {
        const msg = err?.message || "网络异常，登录失败";
        setErrorMessage(msg);
        toast.error(msg);
      }
    });
  };

  const handleQuickFill = () => {
    setAccount("admin");
    setPassword("admin");
    setErrorMessage("");
    toast.info("已填入预置管理员账号凭证 (admin / admin)");
  };

  return (
    <div className="login-container">
      {/* Background Graphic Accents */}
      <div className="login-bg-glow login-bg-glow-1" />
      <div className="login-bg-glow login-bg-glow-2" />

      <div className="login-card">
        {/* Header */}
        <div className="login-header">
          <div className="login-brand-badge">
            <Building2 className="login-brand-icon" size={15} />
            <span>12345 政务热线智能研判平台 · V2 双引擎架构</span>
          </div>
          <h1 className="login-title">民声智理 · 智能研判系统</h1>
          <p className="login-subtitle">
            基于快慢思考双引擎协同 · 微观时空实体对齐 · 多频诉求全自动研判流水线
          </p>
          <div className="login-features-row">
            <span className="login-feature-pill">
              <Zap size={11} style={{ color: "#d97706" }} />
              快慢双引擎协同
            </span>
            <span className="login-feature-pill">
              <Layers size={11} style={{ color: "#2563eb" }} />
              微观时空基底
            </span>
            <span className="login-feature-pill">
              <Activity size={11} style={{ color: "#16a34a" }} />
              全自动研判闭环
            </span>
          </div>
        </div>

        {/* Quick Demo Hint */}
        <div className="login-demo-banner" onClick={handleQuickFill} role="button" tabIndex={0}>
          <div className="login-demo-badge">
            <Sparkles size={14} />
            <span>演示快捷通道 · 一键填入</span>
          </div>
          <div className="login-demo-desc">
            预置管理员账号：<code>admin</code> / 密码：<code>admin</code>（点击直接填入体验）
          </div>
        </div>

        {/* Error Alert */}
        {errorMessage ? (
          <div className="login-error-alert">
            <ShieldCheck size={16} />
            <span>{errorMessage}</span>
          </div>
        ) : null}

        {/* Login Form */}
        <form onSubmit={handleLogin} className="login-form">
          <div className="form-group">
            <label className="form-label" htmlFor="account">
              登录账号 / 邮箱
            </label>
            <div className="input-wrapper">
              <User className="input-icon" size={18} />
              <input
                id="account"
                type="text"
                className="form-input"
                placeholder="请输入用户名或管理员邮箱（默认 admin）"
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                autoComplete="username"
                disabled={isPending}
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="password">
              登录密码
            </label>
            <div className="input-wrapper">
              <Lock className="input-icon" size={18} />
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                className="form-input form-input-password"
                placeholder="请输入登录密码（默认 admin）"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                disabled={isPending}
                required
              />
              <button
                type="button"
                className="password-toggle-btn"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
                aria-label={showPassword ? "隐藏密码" : "显示密码"}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            className="login-submit-btn"
            disabled={isPending}
          >
            {isPending ? (
              <span className="submit-loading-text">
                <span className="login-spinner" /> 正在验证凭证并加载工作台...
              </span>
            ) : (
              <span className="submit-btn-content">
                安全登录进入研判工作台
              </span>
            )}
          </button>
        </form>

        {/* Footer info */}
        <div className="login-footer">
          <div className="security-tag">
            <ShieldCheck size={14} />
            <span>政务信创适配 · 端侧纯离线推理 · 隐私气隙脱敏 · 多租户 Schema 物理隔离</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="login-container">
        <div className="login-card" style={{ textAlign: "center", padding: "48px 24px" }}>
          <div className="login-spinner" style={{ margin: "0 auto 16px auto", borderColor: "rgba(22, 119, 255, 0.3)", borderTopColor: "#1677ff" }} />
          <div style={{ color: "var(--c-ink-3)", fontSize: "14px" }}>正在初始化智能研判工作台...</div>
        </div>
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}
