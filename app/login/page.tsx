"use client";

import { useRef, useState, useTransition, Suspense } from "react";
import { useSearchParams } from "next/navigation";
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
  Mail,
  UserPlus,
  LogIn,
} from "lucide-react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth/client";
import { useRegion } from "@/app/_components/civic/region-context";

type AuthTab = "login" | "register";

const ADMIN_ROUTE_PREFIXES = [
  "/themes",
  "/multifreq",
  "/tickets",
  "/dict",
  "/sandbox",
  "/screen",
  "/admin",
  "/agent",
  "/workbench",
];

function isAdminRoutePath(path: string): boolean {
  if (path === "/") return true;
  return ADMIN_ROUTE_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`)
  );
}

function LoginForm() {
  const { appDomain } = useRegion();
  const isEcommerce = appDomain === "ECOMMERCE_CS";
  const searchParams = useSearchParams();
  const rawFrom = searchParams.get("from");

  const [authTab, setAuthTab] = useState<AuthTab>("login");
  const loginTabRef = useRef<HTMLButtonElement>(null);
  const registerTabRef = useRef<HTMLButtonElement>(null);

  // 登录表单状态
  const [account, setAccount] = useState("admin");
  const [password, setPassword] = useState("admin");
  const [showPassword, setShowPassword] = useState(false);
  const [loginInteracted, setLoginInteracted] = useState<Record<string, boolean>>({});
  const [loginErrors, setLoginErrors] = useState<Record<string, string>>({});

  // 注册表单状态
  const [regName, setRegName] = useState("");
  const [regUsername, setRegUsername] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [showRegPassword, setShowRegPassword] = useState(false);
  const [regInteracted, setRegInteracted] = useState<Record<string, boolean>>({});
  const [regErrors, setRegErrors] = useState<Record<string, string>>({});

  const [errorMessage, setErrorMessage] = useState("");
  const [liveAnnouncement, setLiveAnnouncement] = useState("");
  const [isPending, startTransition] = useTransition();

  const loginAccountRef = useRef<HTMLInputElement>(null);
  const loginPasswordRef = useRef<HTMLInputElement>(null);
  const regNameRef = useRef<HTMLInputElement>(null);
  const regUsernameRef = useRef<HTMLInputElement>(null);
  const regEmailRef = useRef<HTMLInputElement>(null);
  const regPasswordRef = useRef<HTMLInputElement>(null);

  const handleTabChange = (next: AuthTab, focusTab = false) => {
    setAuthTab(next);
    setErrorMessage("");
    setLiveAnnouncement("");
    if (focusTab) {
      requestAnimationFrame(() => {
        if (next === "login") loginTabRef.current?.focus();
        else registerTabRef.current?.focus();
      });
    }
  };

  const handleTabListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft" || e.key === "Home" || e.key === "End") {
      e.preventDefault();
      if (e.key === "Home") {
        handleTabChange("login", true);
        return;
      }
      if (e.key === "End") {
        handleTabChange("register", true);
        return;
      }
      handleTabChange(authTab === "login" ? "register" : "login", true);
    }
  };

  const validateLoginField = (field: "account" | "password", value: string): string => {
    if (field === "account" && !value.trim()) {
      return "请输入登录用户名或邮箱";
    }
    if (field === "password" && !value.trim()) {
      return "请输入登录密码";
    }
    return "";
  };

  const validateRegField = (
    field: "name" | "username" | "email" | "password",
    value: string
  ): string => {
    const v = value.trim();
    if (field === "name") {
      if (!v) return "请输入您的称呼或姓名";
      return "";
    }
    if (field === "username") {
      if (!v) return "请输入用户名（至少 3 位字符）";
      if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(v)) {
        return "用户名需为 3~32 位字母、数字、下划线或点号";
      }
      return "";
    }
    if (field === "email") {
      if (!v) return "请输入邮箱地址";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
        return "请输入格式正确的邮箱，例如 citizen@example.com";
      }
      return "";
    }
    if (field === "password") {
      if (!value) return "请设置登录密码（至少 4 位）";
      if (value.length < 4) return "密码长度不能少于 4 位";
      return "";
    }
    return "";
  };

  const resolvePostLoginTarget = (role: string | null | undefined): string => {
    const normalizedRole = role === "admin" ? "admin" : "user";
    if (!rawFrom || rawFrom === "/") {
      return normalizedRole === "user" ? "/submit" : "/";
    }
    if (normalizedRole === "user" && isAdminRoutePath(rawFrom)) {
      return "/submit";
    }
    return rawFrom;
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const accErr = validateLoginField("account", account);
    const pwdErr = validateLoginField("password", password);
    setLoginInteracted({ account: true, password: true });
    setLoginErrors({
      ...(accErr ? { account: accErr } : {}),
      ...(pwdErr ? { password: pwdErr } : {}),
    });

    if (accErr || pwdErr) {
      setErrorMessage(accErr || pwdErr);
      setLiveAnnouncement(accErr || pwdErr);
      if (accErr) loginAccountRef.current?.focus();
      else loginPasswordRef.current?.focus();
      return;
    }

    setErrorMessage("");
    setLiveAnnouncement("");

    startTransition(async () => {
      try {
        const cleanAccount = account.trim();
        const isEmail = cleanAccount.includes("@");
        const res = isEmail
          ? await authClient.signIn.email({
              email: cleanAccount,
              password: password.trim(),
            })
          : await authClient.signIn.username({
              username: cleanAccount,
              password: password.trim(),
            });

        if (res.error) {
          const msg =
            res.error.message === "Invalid email or password" ||
            res.error.message === "Invalid username or password"
              ? "账号或密码错误，请检查后重试"
              : res.error.message || "登录失败，请稍后重试";
          setErrorMessage(msg);
          setLiveAnnouncement(msg);
          toast.error(msg);
          return;
        }

        let userRole = (res.data?.user as { role?: string } | undefined)?.role;
        if (!userRole) {
          const sessionRes = await authClient.getSession().catch(() => null);
          userRole = (sessionRes?.data?.user as { role?: string } | undefined)?.role;
        }

        const targetUrl = resolvePostLoginTarget(userRole);
        toast.success(
          userRole === "admin"
            ? "管理员验证成功，正在进入研判工作台..."
            : `验证成功，正在进入${isEcommerce ? "客诉受理" : "诉求提交"}服务台...`
        );
        window.location.href = targetUrl;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "网络异常，登录失败";
        setErrorMessage(msg);
        setLiveAnnouncement(msg);
        toast.error(msg);
      }
    });
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {
      name: validateRegField("name", regName),
      username: validateRegField("username", regUsername),
      email: validateRegField("email", regEmail),
      password: validateRegField("password", regPassword),
    };
    const filteredErrs = Object.fromEntries(
      Object.entries(errs).filter(([, v]) => Boolean(v))
    );
    setRegInteracted({ name: true, username: true, email: true, password: true });
    setRegErrors(filteredErrs);

    if (Object.keys(filteredErrs).length > 0) {
      const firstErr = Object.values(filteredErrs)[0];
      setErrorMessage(firstErr);
      setLiveAnnouncement(firstErr);
      if (errs.name) regNameRef.current?.focus();
      else if (errs.username) regUsernameRef.current?.focus();
      else if (errs.email) regEmailRef.current?.focus();
      else if (errs.password) regPasswordRef.current?.focus();
      return;
    }

    setErrorMessage("");
    setLiveAnnouncement("");

    startTransition(async () => {
      try {
        const res = await authClient.signUp.email({
          email: regEmail.trim(),
          password: regPassword,
          name: regName.trim(),
          username: regUsername.trim(),
        });

        if (res.error) {
          const msg = res.error.message || "注册失败，请检查用户名或邮箱是否已被占用";
          setErrorMessage(msg);
          setLiveAnnouncement(msg);
          toast.error(msg);
          return;
        }

        toast.success(
          `注册成功，正在进入${isEcommerce ? "买家客诉" : "市民诉求"}服务台...`
        );
        window.location.href = "/submit";
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "网络异常，注册失败";
        setErrorMessage(msg);
        setLiveAnnouncement(msg);
        toast.error(msg);
      }
    });
  };

  const handleQuickFillAdmin = () => {
    setAuthTab("login");
    setAccount("admin");
    setPassword("admin");
    setErrorMessage("");
    setLoginErrors({});
    toast.info("已填入管理员体验凭证 (admin / admin)");
  };

  const handleQuickFillCitizen = () => {
    setAuthTab("login");
    setAccount("citizen");
    setPassword("citizen123");
    setErrorMessage("");
    setLoginErrors({});
    toast.info(
      `已填入${isEcommerce ? "消费者买家" : "普通市民"}体验凭证 (citizen / citizen123)`
    );
  };

  return (
    <div className="login-container">
      <div className="login-bg-glow login-bg-glow-1" />
      <div className="login-bg-glow login-bg-glow-2" />

      <div className="login-card">
        <div className="login-header">
          <div className="login-brand-badge">
            <Building2 className="login-brand-icon" size={15} aria-hidden="true" />
            <span className="login-brand-text">
              <span>
                {isEcommerce ? "全渠道电商客诉智能研判平台" : "12345 政务热线智能研判平台"}
              </span>
              <span>V2 双角色协同</span>
            </span>
          </div>
          <h1 className="login-title">
            {isEcommerce ? "民声智理 · 电商客诉中枢" : "民声智理 · 智能研判系统"}
          </h1>
          <p className="login-subtitle">
            <span>快慢双引擎协同</span>
            <span>{isEcommerce ? "SKU / 仓网实体对齐" : "微观时空实体对齐"}</span>
            <span>{isEcommerce ? "买家客诉与督办闭环" : "市民诉求受理与治理闭环"}</span>
          </p>
          <div className="login-features-row">
            <span className="login-feature-pill">
              <Zap size={11} style={{ color: "#d97706" }} aria-hidden="true" />
              快慢双引擎协同
            </span>
            <span className="login-feature-pill">
              <Layers size={11} style={{ color: "#2563eb" }} aria-hidden="true" />
              {isEcommerce ? "渠道仓网矩阵" : "微观时空基底"}
            </span>
            <span className="login-feature-pill">
              <Activity size={11} style={{ color: "#16a34a" }} aria-hidden="true" />
              {isEcommerce ? "售后假闭环督办" : "主动巡检闭环"}
            </span>
          </div>
        </div>

        {/* 并排双角色一键体验区 */}
        <div className="mb-4 rounded-xl border border-dashed border-blue-300 bg-blue-50/70 p-3">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-blue-700">
            <Sparkles size={14} aria-hidden="true" />
            <span>演示快捷通道 · 选择身份一键填入</span>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={handleQuickFillAdmin}
              className="flex min-h-11 flex-col items-start justify-center rounded-lg border border-blue-200 bg-white px-3 py-2 text-left transition hover:border-blue-400 hover:bg-blue-50 cursor-pointer"
            >
              <span className="text-xs font-semibold text-slate-900">
                管理员工作台
              </span>
              <span className="mt-0.5 text-[11px] font-mono text-blue-700">
                admin / admin
              </span>
            </button>
            <button
              type="button"
              onClick={handleQuickFillCitizen}
              className="flex min-h-11 flex-col items-start justify-center rounded-lg border border-emerald-200 bg-white px-3 py-2 text-left transition hover:border-emerald-400 hover:bg-emerald-50 cursor-pointer"
            >
              <span className="text-xs font-semibold text-slate-900">
                {isEcommerce ? "普通买家投诉端" : "普通市民投诉端"}
              </span>
              <span className="mt-0.5 text-[11px] font-mono text-emerald-700">
                citizen / citizen123
              </span>
            </button>
          </div>
        </div>

        {/* 无障碍 Tab 切换：登录 / 体验注册 */}
        <div
          role="tablist"
          aria-label="账号认证方式"
          onKeyDown={handleTabListKeyDown}
          className="mb-4 flex border-b border-slate-200"
        >
          <button
            ref={loginTabRef}
            type="button"
            role="tab"
            id="auth-tab-login"
            aria-selected={authTab === "login"}
            tabIndex={authTab === "login" ? 0 : -1}
            onClick={() => handleTabChange("login")}
            className={`relative flex-1 min-h-11 inline-flex items-center justify-center gap-1.5 px-3 text-sm transition-colors cursor-pointer ${
              authTab === "login"
                ? "font-semibold text-blue-700"
                : "font-medium text-slate-600 hover:text-slate-900"
            }`}
          >
            <LogIn size={15} aria-hidden="true" />
            <span>账号登录</span>
            {authTab === "login" ? (
              <span
                aria-hidden="true"
                className="absolute inset-x-0 bottom-0 border-b-[3px] border-blue-600"
              />
            ) : null}
          </button>
          <button
            ref={registerTabRef}
            type="button"
            role="tab"
            id="auth-tab-register"
            aria-selected={authTab === "register"}
            tabIndex={authTab === "register" ? 0 : -1}
            onClick={() => handleTabChange("register")}
            className={`relative flex-1 min-h-11 inline-flex items-center justify-center gap-1.5 px-3 text-sm transition-colors cursor-pointer ${
              authTab === "register"
                ? "font-semibold text-blue-700"
                : "font-medium text-slate-600 hover:text-slate-900"
            }`}
          >
            <UserPlus size={15} aria-hidden="true" />
            <span>{isEcommerce ? "买家体验注册" : "市民体验注册"}</span>
            {authTab === "register" ? (
              <span
                aria-hidden="true"
                className="absolute inset-x-0 bottom-0 border-b-[3px] border-blue-600"
              />
            ) : null}
          </button>
        </div>

        {/* 单一页面级礼貌播报区 */}
        <div className="sr-only" aria-live="polite">
          {liveAnnouncement}
        </div>

        {/* Error Alert */}
        {errorMessage ? (
          <div className="login-error-alert" role="alert">
            <ShieldCheck size={16} aria-hidden="true" />
            <span>{errorMessage}</span>
          </div>
        ) : null}

        {/* Panel 1: 账号登录 */}
        <div role="tabpanel" aria-labelledby="auth-tab-login" hidden={authTab !== "login"}>
          <form onSubmit={handleLogin} noValidate className="login-form">
            <div className="form-group">
              <label className="form-label" htmlFor="account">
                登录账号 / 邮箱 <span aria-hidden="true" className="text-red-600">*</span>
              </label>
              <div className="input-wrapper">
                <User className="input-icon" size={18} aria-hidden="true" />
                <input
                  ref={loginAccountRef}
                  id="account"
                  name="account"
                  type="text"
                  className={`form-input min-h-12 !text-base ${
                    loginInteracted.account && loginErrors.account
                      ? "!border-red-500 bg-red-50/40"
                      : ""
                  }`}
                  placeholder="请输入用户名或邮箱（admin / citizen）"
                  value={account}
                  onChange={(e) => {
                    const val = e.target.value;
                    setAccount(val);
                    if (loginErrors.account && !validateLoginField("account", val)) {
                      setLoginErrors((prev) => ({ ...prev, account: "" }));
                    }
                  }}
                  onBlur={() => {
                    setLoginInteracted((prev) => ({ ...prev, account: true }));
                    const err = validateLoginField("account", account);
                    setLoginErrors((prev) => ({ ...prev, account: err }));
                    if (err) setLiveAnnouncement(err);
                  }}
                  autoComplete="username"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  enterKeyHint="next"
                  aria-invalid={Boolean(loginInteracted.account && loginErrors.account)}
                  aria-describedby={
                    loginInteracted.account && loginErrors.account
                      ? "login-account-error"
                      : undefined
                  }
                  disabled={isPending}
                  required
                />
              </div>
              {loginInteracted.account && loginErrors.account ? (
                <p id="login-account-error" className="text-xs text-red-600">
                  {loginErrors.account}
                </p>
              ) : null}
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="password">
                登录密码 <span aria-hidden="true" className="text-red-600">*</span>
              </label>
              <div className="input-wrapper">
                <Lock className="input-icon" size={18} aria-hidden="true" />
                <input
                  ref={loginPasswordRef}
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  className={`form-input form-input-password min-h-12 !text-base ${
                    loginInteracted.password && loginErrors.password
                      ? "!border-red-500 bg-red-50/40"
                      : ""
                  }`}
                  placeholder="请输入登录密码"
                  value={password}
                  onChange={(e) => {
                    const val = e.target.value;
                    setPassword(val);
                    if (loginErrors.password && !validateLoginField("password", val)) {
                      setLoginErrors((prev) => ({ ...prev, password: "" }));
                    }
                  }}
                  onBlur={() => {
                    setLoginInteracted((prev) => ({ ...prev, password: true }));
                    const err = validateLoginField("password", password);
                    setLoginErrors((prev) => ({ ...prev, password: err }));
                    if (err) setLiveAnnouncement(err);
                  }}
                  autoComplete="current-password"
                  enterKeyHint="done"
                  aria-invalid={Boolean(loginInteracted.password && loginErrors.password)}
                  aria-describedby={
                    loginInteracted.password && loginErrors.password
                      ? "login-password-error"
                      : undefined
                  }
                  disabled={isPending}
                  required
                />
                <button
                  type="button"
                  className="password-toggle-btn min-w-9 min-h-9"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-pressed={showPassword}
                  aria-label={showPassword ? "隐藏密码" : "显示密码"}
                >
                  {showPassword ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                </button>
              </div>
              {loginInteracted.password && loginErrors.password ? (
                <p id="login-password-error" className="text-xs text-red-600">
                  {loginErrors.password}
                </p>
              ) : null}
            </div>

            <button
              type="submit"
              className="login-submit-btn min-h-12"
              disabled={isPending}
            >
              {isPending ? (
                <span className="submit-loading-text">
                  <span className="login-spinner" /> 正在验证凭证并跳转...
                </span>
              ) : (
                <span className="submit-btn-content">安全登录进入系统</span>
              )}
            </button>
          </form>
        </div>

        {/* Panel 2: 普通市民/买家体验注册 */}
        <div role="tabpanel" aria-labelledby="auth-tab-register" hidden={authTab !== "register"}>
          <form onSubmit={handleRegister} noValidate className="login-form">
            <div className="form-group">
              <label className="form-label" htmlFor="reg-name">
                昵称 / 姓名 <span aria-hidden="true" className="text-red-600">*</span>
              </label>
              <div className="input-wrapper">
                <User className="input-icon" size={18} aria-hidden="true" />
                <input
                  ref={regNameRef}
                  id="reg-name"
                  name="name"
                  type="text"
                  className={`form-input min-h-12 !text-base ${
                    regInteracted.name && regErrors.name ? "!border-red-500 bg-red-50/40" : ""
                  }`}
                  placeholder="例如：张先生 / 王女士"
                  value={regName}
                  onChange={(e) => {
                    const val = e.target.value;
                    setRegName(val);
                    if (regErrors.name && !validateRegField("name", val)) {
                      setRegErrors((prev) => ({ ...prev, name: "" }));
                    }
                  }}
                  onBlur={() => {
                    setRegInteracted((prev) => ({ ...prev, name: true }));
                    const err = validateRegField("name", regName);
                    setRegErrors((prev) => ({ ...prev, name: err }));
                    if (err) setLiveAnnouncement(err);
                  }}
                  autoComplete="name"
                  enterKeyHint="next"
                  aria-invalid={Boolean(regInteracted.name && regErrors.name)}
                  aria-describedby={
                    regInteracted.name && regErrors.name ? "reg-name-error" : undefined
                  }
                  disabled={isPending}
                  required
                />
              </div>
              {regInteracted.name && regErrors.name ? (
                <p id="reg-name-error" className="text-xs text-red-600">
                  {regErrors.name}
                </p>
              ) : null}
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="reg-username">
                登录用户名 <span aria-hidden="true" className="text-red-600">*</span>
              </label>
              <span id="reg-username-hint" className="text-xs text-slate-500">
                3~32 位字母、数字、下划线或点号
              </span>
              <div className="input-wrapper">
                <User className="input-icon" size={18} aria-hidden="true" />
                <input
                  ref={regUsernameRef}
                  id="reg-username"
                  name="username"
                  type="text"
                  className={`form-input min-h-12 !text-base ${
                    regInteracted.username && regErrors.username
                      ? "!border-red-500 bg-red-50/40"
                      : ""
                  }`}
                  placeholder="例如：citizen_01"
                  value={regUsername}
                  onChange={(e) => {
                    const val = e.target.value;
                    setRegUsername(val);
                    if (regErrors.username && !validateRegField("username", val)) {
                      setRegErrors((prev) => ({ ...prev, username: "" }));
                    }
                  }}
                  onBlur={() => {
                    setRegInteracted((prev) => ({ ...prev, username: true }));
                    const err = validateRegField("username", regUsername);
                    setRegErrors((prev) => ({ ...prev, username: err }));
                    if (err) setLiveAnnouncement(err);
                  }}
                  autoComplete="username"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  minLength={3}
                  maxLength={32}
                  pattern="[a-zA-Z0-9_.\-]{3,32}"
                  enterKeyHint="next"
                  aria-invalid={Boolean(regInteracted.username && regErrors.username)}
                  aria-describedby={
                    regInteracted.username && regErrors.username
                      ? "reg-username-hint reg-username-error"
                      : "reg-username-hint"
                  }
                  disabled={isPending}
                  required
                />
              </div>
              {regInteracted.username && regErrors.username ? (
                <p id="reg-username-error" className="text-xs text-red-600">
                  {regErrors.username}
                </p>
              ) : null}
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="reg-email">
                电子邮箱 <span aria-hidden="true" className="text-red-600">*</span>
              </label>
              <span id="reg-email-hint" className="text-xs text-slate-500">
                格式示例：user@example.com
              </span>
              <div className="input-wrapper">
                <Mail className="input-icon" size={18} aria-hidden="true" />
                <input
                  ref={regEmailRef}
                  id="reg-email"
                  name="email"
                  type="email"
                  className={`form-input min-h-12 !text-base ${
                    regInteracted.email && regErrors.email ? "!border-red-500 bg-red-50/40" : ""
                  }`}
                  placeholder="请输入您的邮箱"
                  value={regEmail}
                  onChange={(e) => {
                    const val = e.target.value;
                    setRegEmail(val);
                    if (regErrors.email && !validateRegField("email", val)) {
                      setRegErrors((prev) => ({ ...prev, email: "" }));
                    }
                  }}
                  onBlur={() => {
                    setRegInteracted((prev) => ({ ...prev, email: true }));
                    const err = validateRegField("email", regEmail);
                    setRegErrors((prev) => ({ ...prev, email: err }));
                    if (err) setLiveAnnouncement(err);
                  }}
                  autoComplete="email"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  enterKeyHint="next"
                  aria-invalid={Boolean(regInteracted.email && regErrors.email)}
                  aria-describedby={
                    regInteracted.email && regErrors.email
                      ? "reg-email-hint reg-email-error"
                      : "reg-email-hint"
                  }
                  disabled={isPending}
                  required
                />
              </div>
              {regInteracted.email && regErrors.email ? (
                <p id="reg-email-error" className="text-xs text-red-600">
                  {regErrors.email}
                </p>
              ) : null}
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="reg-password">
                设置密码 <span aria-hidden="true" className="text-red-600">*</span>
              </label>
              <span id="reg-password-hint" className="text-xs text-slate-500">
                至少 4 位字符，注册后将以普通用户身份直达投诉受理台
              </span>
              <div className="input-wrapper">
                <Lock className="input-icon" size={18} aria-hidden="true" />
                <input
                  ref={regPasswordRef}
                  id="reg-password"
                  name="password"
                  type={showRegPassword ? "text" : "password"}
                  className={`form-input form-input-password min-h-12 !text-base ${
                    regInteracted.password && regErrors.password
                      ? "!border-red-500 bg-red-50/40"
                      : ""
                  }`}
                  placeholder="请设置登录密码"
                  value={regPassword}
                  onChange={(e) => {
                    const val = e.target.value;
                    setRegPassword(val);
                    if (regErrors.password && !validateRegField("password", val)) {
                      setRegErrors((prev) => ({ ...prev, password: "" }));
                    }
                  }}
                  onBlur={() => {
                    setRegInteracted((prev) => ({ ...prev, password: true }));
                    const err = validateRegField("password", regPassword);
                    setRegErrors((prev) => ({ ...prev, password: err }));
                    if (err) setLiveAnnouncement(err);
                  }}
                  autoComplete="new-password"
                  minLength={4}
                  enterKeyHint="done"
                  aria-invalid={Boolean(regInteracted.password && regErrors.password)}
                  aria-describedby={
                    regInteracted.password && regErrors.password
                      ? "reg-password-hint reg-password-error"
                      : "reg-password-hint"
                  }
                  disabled={isPending}
                  required
                />
                <button
                  type="button"
                  className="password-toggle-btn min-w-9 min-h-9"
                  onClick={() => setShowRegPassword((prev) => !prev)}
                  aria-pressed={showRegPassword}
                  aria-label={showRegPassword ? "隐藏密码" : "显示密码"}
                >
                  {showRegPassword ? (
                    <EyeOff size={16} aria-hidden="true" />
                  ) : (
                    <Eye size={16} aria-hidden="true" />
                  )}
                </button>
              </div>
              {regInteracted.password && regErrors.password ? (
                <p id="reg-password-error" className="text-xs text-red-600">
                  {regErrors.password}
                </p>
              ) : null}
            </div>

            <button
              type="submit"
              className="login-submit-btn min-h-12"
              disabled={isPending}
            >
              {isPending ? (
                <span className="submit-loading-text">
                  <span className="login-spinner" /> 正在创建账号并登录...
                </span>
              ) : (
                <span className="submit-btn-content">
                  完成注册并开始{isEcommerce ? "客诉提交" : "诉求提交"}
                </span>
              )}
            </button>
          </form>
        </div>

        <div className="login-footer">
          <div className="security-tag">
            <ShieldCheck size={14} aria-hidden="true" />
            <span className="security-tag__text">
              <span>{isEcommerce ? "企业级合规适配" : "政务信创适配"}</span>
              <span>双角色权限隔离</span>
              <span>隐私气隙脱敏</span>
              <span>多租户 Schema 物理隔离</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="login-container">
          <div className="login-card" style={{ textAlign: "center", padding: "48px 24px" }}>
            <div
              className="login-spinner"
              style={{
                margin: "0 auto 16px auto",
                borderColor: "rgba(22, 119, 255, 0.3)",
                borderTopColor: "#1677ff",
              }}
            />
            <div style={{ color: "var(--c-ink-3)", fontSize: "14px" }}>
              正在初始化认证服务...
            </div>
          </div>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
