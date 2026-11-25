"use client";

import { useRef, useState, useTransition, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  ShieldCheck,
  AlertCircle,
  Lock,
  User,
  Eye,
  EyeOff,
  Mail,
  UserPlus,
  LogIn,
} from "lucide-react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth/client";
import { useRegion } from "@/app/_components/civic/region-context";
import { resolvePostLoginTarget } from "@/lib/security/login-redirect";

type AuthTab = "login" | "register";

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
      if (next === "login") loginTabRef.current?.focus();
      else registerTabRef.current?.focus();
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
          return;
        }

        let userRole = (res.data?.user as { role?: string } | undefined)?.role;
        if (!userRole) {
          const sessionRes = await authClient.getSession().catch(() => null);
          userRole = (sessionRes?.data?.user as { role?: string } | undefined)?.role;
        }

        const targetUrl = resolvePostLoginTarget(userRole, rawFrom);
        toast.success(
          userRole === "admin"
            ? "管理员验证成功，正在进入研判工作台..."
            : `验证成功，正在进入${isEcommerce ? "客诉受理" : "诉求提交"}服务台...`
        );
        window.location.href = targetUrl;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "网络异常，登录失败";
        setErrorMessage(msg);
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
          return;
        }

        toast.success(
          `注册成功，正在进入${isEcommerce ? "买家客诉" : "市民诉求"}服务台...`
        );
        window.location.href = "/submit";
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "网络异常，注册失败";
        setErrorMessage(msg);
      }
    });
  };

  const handleQuickFillAdmin = () => {
    setAuthTab("login");
    setAccount("admin");
    setPassword("admin");
    setErrorMessage("");
    setLoginErrors({});
    setLiveAnnouncement("已填入管理员体验凭证");
    toast.info("已填入管理员体验凭证 (admin / admin)");
  };

  const handleQuickFillCitizen = () => {
    setAuthTab("login");
    setAccount("citizen");
    setPassword("citizen123");
    setErrorMessage("");
    setLoginErrors({});
    setLiveAnnouncement(`已填入${isEcommerce ? "消费者买家" : "普通市民"}体验凭证`);
    toast.info(
      `已填入${isEcommerce ? "消费者买家" : "普通市民"}体验凭证 (citizen / citizen123)`
    );
  };

  return (
    <div className="login-container">
      <div className="login-bg-glow login-bg-glow-1" />
      <div className="login-bg-glow login-bg-glow-2" />

      <div className="login-card !py-5 !px-4 sm:!py-6 sm:!px-8">
        <div className="login-header !mb-3">
          <h1 className="login-title">
            {isEcommerce ? "民声智理 · 电商客诉中枢" : "民声智理 · 智能研判系统"}
          </h1>
          <p className="login-subtitle !text-[13px]">
            {isEcommerce
              ? "快慢双引擎协同 · SKU / 仓网实体对齐与客诉闭环"
              : "快慢双引擎协同 · 微观时空对齐与治理闭环"}
          </p>
        </div>

        {/* 紧凑单行演示凭证快捷填入条（无嵌套卡框） */}
        <div className="mb-3 grid grid-cols-2 sm:flex sm:items-center gap-1.5 rounded-lg bg-slate-100/80 p-1.5">
          <span className="hidden sm:inline px-1 text-[13px] font-medium text-slate-600 shrink-0">
            演示
          </span>
          <button
            type="button"
            onClick={handleQuickFillAdmin}
            aria-label="填入管理员演示账号 admin / admin"
            className="inline-flex min-h-11 sm:min-h-9 sm:flex-1 items-center justify-center rounded-md bg-white px-2 text-[13px] font-medium text-blue-700 hover:bg-blue-50 transition-colors cursor-pointer tabular-nums whitespace-nowrap min-w-0"
          >
            管理员 admin/admin
          </button>
          <button
            type="button"
            onClick={handleQuickFillCitizen}
            aria-label={`填入${isEcommerce ? "买家" : "市民"}演示账号 citizen / citizen123`}
            className="inline-flex min-h-11 sm:min-h-9 sm:flex-1 items-center justify-center rounded-md bg-white px-2 text-[13px] font-medium text-emerald-700 hover:bg-emerald-50 transition-colors cursor-pointer tabular-nums whitespace-nowrap min-w-0"
          >
            {isEcommerce ? "买家" : "市民"} citizen/citizen123
          </button>
        </div>

        {/* 无障碍 Tab 切换：登录 / 体验注册 */}
        <div
          role="tablist"
          aria-label="账号认证方式"
          onKeyDown={handleTabListKeyDown}
          className="mb-3 flex border-b border-slate-200"
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
            <AlertCircle size={16} aria-hidden="true" className="shrink-0" />
            <span>{errorMessage}</span>
          </div>
        ) : null}

        {/* Panel 1: 账号登录 */}
        <div role="tabpanel" aria-labelledby="auth-tab-login" hidden={authTab !== "login"}>
          <form onSubmit={handleLogin} noValidate className="login-form !gap-3">
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
                <p id="login-account-error" className="text-[13px] text-red-600">
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
                  className="password-toggle-btn w-9 h-9 after:content-[''] after:absolute after:-inset-[4px]"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-pressed={showPassword}
                  aria-label="显示密码"
                  aria-describedby="login-password-toggle-warning"
                >
                  {showPassword ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                </button>
              </div>
              <span id="login-password-toggle-warning" className="sr-only">
                注意：开启后将在屏幕上明文显示您输入的密码。
              </span>
              {loginInteracted.password && loginErrors.password ? (
                <p id="login-password-error" className="text-[13px] text-red-600">
                  {loginErrors.password}
                </p>
              ) : null}
            </div>

            <button
              type="submit"
              className="login-submit-btn min-h-12 !mt-1"
              disabled={isPending}
            >
              {isPending ? (
                <span className="submit-loading-text">
                  <span className="login-spinner" aria-hidden="true" /> 正在验证凭证并跳转...
                </span>
              ) : (
                <span className="submit-btn-content">安全登录进入系统</span>
              )}
            </button>
          </form>
        </div>

        {/* Panel 2: 普通市民/买家体验注册 */}
        <div role="tabpanel" aria-labelledby="auth-tab-register" hidden={authTab !== "register"}>
          <form onSubmit={handleRegister} noValidate className="login-form !gap-2.5">
            <div className="form-group !gap-1">
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
                  className={`form-input !min-h-11 !text-base ${
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
                <p id="reg-name-error" className="text-[13px] text-red-600">
                  {regErrors.name}
                </p>
              ) : null}
            </div>

            <div className="form-group !gap-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                <label className="form-label" htmlFor="reg-username">
                  登录用户名 <span aria-hidden="true" className="text-red-600">*</span>
                </label>
                <span id="reg-username-hint" className="text-[13px] text-slate-500">
                  3~32 位字母/数字/._
                </span>
              </div>
              <div className="input-wrapper">
                <User className="input-icon" size={18} aria-hidden="true" />
                <input
                  ref={regUsernameRef}
                  id="reg-username"
                  name="username"
                  type="text"
                  className={`form-input !min-h-11 !text-base ${
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
                  pattern="[a-zA-Z0-9_.-]{3,32}"
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
                <p id="reg-username-error" className="text-[13px] text-red-600">
                  {regErrors.username}
                </p>
              ) : null}
            </div>

            <div className="form-group !gap-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                <label className="form-label" htmlFor="reg-email">
                  电子邮箱 <span aria-hidden="true" className="text-red-600">*</span>
                </label>
                <span id="reg-email-hint" className="text-[13px] text-slate-500">
                  如 user@example.com
                </span>
              </div>
              <div className="input-wrapper">
                <Mail className="input-icon" size={18} aria-hidden="true" />
                <input
                  ref={regEmailRef}
                  id="reg-email"
                  name="email"
                  type="email"
                  className={`form-input !min-h-11 !text-base ${
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
                <p id="reg-email-error" className="text-[13px] text-red-600">
                  {regErrors.email}
                </p>
              ) : null}
            </div>

            <div className="form-group !gap-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                <label className="form-label" htmlFor="reg-password">
                  设置密码 <span aria-hidden="true" className="text-red-600">*</span>
                </label>
                <span id="reg-password-hint" className="text-[13px] text-slate-500">
                  至少 4 位字符
                </span>
              </div>
              <div className="input-wrapper">
                <Lock className="input-icon" size={18} aria-hidden="true" />
                <input
                  ref={regPasswordRef}
                  id="reg-password"
                  name="password"
                  type={showRegPassword ? "text" : "password"}
                  className={`form-input form-input-password !min-h-11 !text-base ${
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
                  className="password-toggle-btn w-9 h-9 after:content-[''] after:absolute after:-inset-[4px]"
                  onClick={() => setShowRegPassword((prev) => !prev)}
                  aria-pressed={showRegPassword}
                  aria-label="显示密码"
                  aria-describedby="reg-password-toggle-warning"
                >
                  {showRegPassword ? (
                    <EyeOff size={16} aria-hidden="true" />
                  ) : (
                    <Eye size={16} aria-hidden="true" />
                  )}
                </button>
              </div>
              <span id="reg-password-toggle-warning" className="sr-only">
                注意：开启后将在屏幕上明文显示您设置的密码。
              </span>
              {regInteracted.password && regErrors.password ? (
                <p id="reg-password-error" className="text-[13px] text-red-600">
                  {regErrors.password}
                </p>
              ) : null}
            </div>

            <button
              type="submit"
              className="login-submit-btn min-h-12 !mt-1"
              disabled={isPending}
            >
              {isPending ? (
                <span className="submit-loading-text">
                  <span className="login-spinner" aria-hidden="true" /> 正在创建账号并登录...
                </span>
              ) : (
                <span className="submit-btn-content">注册并登录</span>
              )}
            </button>
          </form>
        </div>

        <div className="login-footer !mt-4 !pt-3">
          <div className="security-tag !text-[13px]">
            <ShieldCheck size={14} aria-hidden="true" className="shrink-0 mt-0.5" />
            <span className="security-tag__text">
              <span>{isEcommerce ? "企业级合规适配" : "政务信创适配"}</span>
              <span>双角色权限隔离</span>
              <span>隐私气隙脱敏</span>
              <span>多租户物理隔离</span>
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
              aria-hidden="true"
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
