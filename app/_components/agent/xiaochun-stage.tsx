"use client";

import React, { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Xiaochun, type XiaochunHandle } from "@firetable/project-xiaochun/react";
import { Sparkles, RefreshCw, Play } from "lucide-react";

export interface XiaochunStageHandle {
  say: (text: string) => Promise<void>;
  activate: () => void;
  stop: () => void;
}

export interface XiaochunStageProps {
  title?: string;
  subtitle?: string;
  caption?: string;
  /** 数字为 px；字符串可传任意 CSS 长度（如 "100%"、"min(72dvh, 720px)"）。 */
  width?: number | string;
  height?: number | string;
  lazy?: boolean | "idle" | "click";
  scene?: "light" | "dark" | "transparent";
  backdropTone?: "dark" | "light";
  outfit?: string;
  /**
   * card：带边框标题栏的小卡片（侧栏/弹窗内使用）。
   * stage：无边框大舞台，人物直接站在页面留白处，字幕以电影感无框沉浸样式浮在下方。
   */
  variant?: "card" | "stage";
  className?: string;
}

/** 大舞台取景：拉近镜头，让人物上半身占满留白（模块级常量，避免引用变化重建 iframe）。 */
const STAGE_CAMERA = { distance: 1.7, height: 0.15 } as const;

/** 首次说话时等待 3D 形象（含冷启动模型合成）就绪的最长时间。 */
const READY_TIMEOUT_MS = 90_000;

function toCssLength(v: number | string): string {
  return typeof v === "number" ? `${v}px` : v;
}

export const XiaochunStage = React.forwardRef<XiaochunStageHandle, XiaochunStageProps>(
  function XiaochunStage(
    {
      title = "智能语音受理员",
      subtitle = "支持语音受理与实时口型播报",
      caption,
      width = 280,
      height = 360,
      lazy = "click",
      scene = "light",
      backdropTone,
      outfit = "xiaochun_civic",
      variant = "card",
      className = "",
    },
    ref
  ) {
    const xiaochunRef = useRef<XiaochunHandle | null>(null);

    const [activated, setActivated] = useState<boolean>(lazy === false);
    const [ready, setReady] = useState<boolean>(false);
    const [progress, setProgress] = useState<number>(0);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [activeCaption, setActiveCaption] = useState<string>(caption || "");

    const isReadyRef = useRef(ready);
    isReadyRef.current = ready;
    const hasLoadErrorRef = useRef(false);

    // 等待模型就绪的挂起者；onReady / onError 时统一结算
    const readyWaitersRef = useRef<Array<(ok: boolean) => void>>([]);
    const settleReadyWaiters = useCallback((ok: boolean) => {
      const waiters = readyWaitersRef.current;
      readyWaitersRef.current = [];
      for (const w of waiters) w(ok);
    }, []);
    // 只保留最后一句：回复来得比模型加载快时，避免排队念旧句子
    const sayTokenRef = useRef(0);

    useEffect(() => {
      if (caption !== undefined) {
        setActiveCaption(caption);
      }
    }, [caption]);

    useEffect(() => {
      if (lazy !== "click") {
        setActivated(true);
      }
    }, [lazy]);

    useEffect(() => {
      return () => settleReadyWaiters(false);
    }, [settleReadyWaiters]);

    const handleActivate = useCallback(() => {
      hasLoadErrorRef.current = false;
      setLoadError(null);
      setProgress(0);
      setActivated(true);
      try {
        xiaochunRef.current?.activate();
      } catch {
        hasLoadErrorRef.current = true;
        setLoadError("3D 形象暂时无法加载，回复将以字幕呈现");
      }
    }, []);

    const waitUntilReady = useCallback((): Promise<boolean> => {
      if (isReadyRef.current) return Promise.resolve(true);
      return new Promise<boolean>((resolve) => {
        const timer = window.setTimeout(() => {
          readyWaitersRef.current = readyWaitersRef.current.filter((w) => w !== done);
          resolve(false);
        }, READY_TIMEOUT_MS);
        const done = (ok: boolean) => {
          window.clearTimeout(timer);
          resolve(ok);
        };
        readyWaitersRef.current.push(done);
      });
    }, []);

    const handleStop = useCallback(() => {
      sayTokenRef.current += 1;
      try {
        void xiaochunRef.current?.stop().catch(() => {});
      } catch {
        // ignore
      }
    }, []);

    const handleSay = useCallback(
      async (text: string): Promise<void> => {
        const clean = (text || "").trim();
        if (!clean) return;
        setActiveCaption(clean);

        const token = ++sayTokenRef.current;
        if (!isReadyRef.current) {
          // 3D 形象已离线降级时不再反复清除错误重连，仅保留字幕呈现；用户点击「重试连接」才重新激活
          if (hasLoadErrorRef.current) return;
          // 统一使用 SDK 内置 TTS（带口型与动作）；未加载时先唤醒，不再退回浏览器语音
          handleActivate();
          const ok = await waitUntilReady();
          if (!ok || token !== sayTokenRef.current) return;
        }

        const handle = xiaochunRef.current;
        if (!handle) return;
        try {
          await handle.say(clean, { mode: "speak" });
        } catch {
          // 播报失败时保留字幕即可
        }
      },
      [handleActivate, waitUntilReady]
    );

    useImperativeHandle(
      ref,
      () => ({
        say: handleSay,
        activate: handleActivate,
        stop: handleStop,
      }),
      [handleSay, handleActivate, handleStop]
    );

    const isStage = variant === "stage";
    const isDark = scene === "dark";
    const resolvedBackdropTone = backdropTone ?? (isDark ? "dark" : "light");
    const shellBg = isStage
      ? "bg-transparent border-transparent text-slate-900"
      : scene === "transparent"
        ? "bg-slate-50/70 border-slate-200/80 text-slate-900 border shadow-sm rounded-xl"
        : isDark
          ? "bg-slate-900 border-slate-700 text-slate-50 border shadow-sm rounded-xl"
          : "bg-slate-50 border-slate-200 text-slate-900 border shadow-sm rounded-xl";

    const overlayCardBg = isDark
      ? "bg-slate-900/90 border-slate-700 text-slate-100"
      : "bg-white/95 border-slate-200 text-slate-800";

    const embedSrc = process.env.NEXT_PUBLIC_XIAOCHUN_EMBED_URL || undefined;
    const cssHeight = toCssLength(height);

    return (
      <div
        className={`relative overflow-hidden select-none ${isStage ? "pointer-events-none " : ""}${shellBg} ${className}`.trim()}
        style={{
          width: toCssLength(width),
          maxWidth: "100%",
          height: cssHeight,
        }}
        data-xiaochun-stage-status={ready ? "ready" : loadError ? "fallback" : activated ? "loading" : "standby"}
        data-xiaochun-variant={variant}
      >
        {!isStage && (
          <div
            className={`absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-2 px-3 py-2 border-b backdrop-blur-sm ${
              isDark
                ? "bg-slate-900/80 border-slate-800 text-slate-100"
                : "bg-white/85 border-slate-200/80 text-slate-900"
            }`}
          >
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold truncate">{title}</div>
              {subtitle ? (
                <div className={`text-[11px] truncate ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                  {subtitle}
                </div>
              ) : null}
            </div>
          </div>
        )}

        {/* 3D 形象挂载容器（stage 模式交由 SDK transparent + passthrough 按网格穿透） */}
        <Xiaochun
          ref={xiaochunRef}
          src={embedSrc}
          className={isStage ? "pointer-events-none" : undefined}
          lang="zh-CN"
          outfit={outfit}
          scene={isStage ? "transparent" : scene}
          camera={isStage ? STAGE_CAMERA : undefined}
          controls={false}
          lazy={lazy}
          heavy="motion"
          placeholder={false}
          width="100%"
          height={cssHeight}
          handshakeTimeout={20000}
          onHandshake={() => {
            hasLoadErrorRef.current = false;
            setLoadError(null);
            setActivated(true);
          }}
          onProgress={(p) => {
            if (p.phase === "model") {
              setProgress(Math.min(100, Math.max(0, Math.round(p.progress))));
            }
          }}
          onReady={() => {
            hasLoadErrorRef.current = false;
            setReady(true);
            isReadyRef.current = true;
            setActivated(true);
            setLoadError(null);
            setProgress(100);
            try {
              xiaochunRef.current?.setVolume(1);
            } catch {
              // ignore
            }
            settleReadyWaiters(true);
          }}
          onError={(err) => {
            hasLoadErrorRef.current = true;
            setLoadError(err?.message || "3D 形象暂不可达，回复将以字幕呈现");
            settleReadyWaiters(false);
          }}
        />

        {/* 待机 / 加载 / 异常降级提示 */}
        {!ready && (
          <div
            className={`absolute inset-0 z-10 flex items-center justify-center p-2.5 sm:p-4 pointer-events-none ${
              isStage ? "" : "pt-14 pb-14"
            }`}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className={`pointer-events-auto w-full max-w-[280px] rounded-xl border px-3.5 py-3 sm:py-4 text-center shadow-sm ${overlayCardBg}`}
            >
              <div
                className={`mx-auto mb-2 flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-full border ${
                  isDark ? "bg-slate-800 border-slate-700 text-blue-400" : "bg-blue-50 border-blue-100 text-blue-600"
                }`}
              >
                <Sparkles size={18} aria-hidden="true" />
              </div>

              {loadError ? (
                <>
                  <p className="text-xs font-semibold">3D 形象暂时离线</p>
                  <p className={`mt-1 text-[11px] leading-relaxed ${isDark ? "text-slate-400" : "text-slate-600"}`}>
                    回复会以文字字幕呈现
                  </p>
                  <button
                    type="button"
                    onClick={handleActivate}
                    className="mt-2.5 inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                  >
                    <RefreshCw size={13} aria-hidden="true" />
                    重试连接 3D 形象
                  </button>
                </>
              ) : activated ? (
                <>
                  <p className="text-xs font-semibold">正在加载语音形象</p>
                  <p className={`mt-1 text-[11px] tabular-nums ${isDark ? "text-slate-400" : "text-slate-600"}`}>
                    {progress > 0 ? `资源加载中 ${progress}%` : "正在建立安全通信通道..."}
                  </p>
                  {progress > 0 ? (
                    <progress
                      value={progress}
                      max={100}
                      aria-label="3D 语音形象加载进度"
                      className="mt-2 block h-1.5 w-full overflow-hidden rounded-full accent-blue-600"
                    />
                  ) : null}
                </>
              ) : (
                <>
                  <p className="text-xs font-semibold">语音形象待机中</p>
                  <p className={`mt-1 text-[11px] leading-relaxed ${isDark ? "text-slate-400" : "text-slate-600"}`}>
                    点击启动后，回复将以语音播报
                  </p>
                  <button
                    type="button"
                    onClick={handleActivate}
                    className="mt-2.5 inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 cursor-pointer"
                  >
                    <Play size={13} aria-hidden="true" />
                    启动语音形象
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* 轻透字幕条（无暗底梯度遮罩与多重文字阴影） */}
        {activeCaption.trim() && (ready || Boolean(loadError)) &&
          (isStage ? (
            <div
              data-xiaochun-scrim="true"
              className="absolute inset-x-0 bottom-0 z-20 pointer-events-none flex justify-center px-4 sm:px-6 pb-4 sm:pb-5"
            >
              <p
                role="status"
                aria-live="polite"
                className={
                  resolvedBackdropTone === "dark"
                    ? "mx-auto max-w-[min(40rem,94%)] rounded-2xl bg-slate-950/72 backdrop-blur-md border border-white/15 px-4 py-2.5 shadow-lg text-center text-[clamp(0.875rem,0.82rem+0.25vw,1rem)] font-medium leading-relaxed text-white/95 line-clamp-3 [text-wrap:balance]"
                    : "mx-auto max-w-[min(40rem,94%)] rounded-2xl bg-white/90 backdrop-blur-md border border-slate-200/85 px-4 py-2.5 shadow-sm text-center text-[clamp(0.875rem,0.82rem+0.25vw,1rem)] font-medium leading-relaxed text-slate-800 line-clamp-3 [text-wrap:balance]"
                }
              >
                {activeCaption}
              </p>
            </div>
          ) : (
            <div
              data-xiaochun-scrim="true"
              className="absolute inset-x-0 bottom-0 z-20 pointer-events-none flex justify-center px-2.5 pb-2.5"
            >
              <p
                role="status"
                aria-live="polite"
                className={
                  isDark
                    ? "mx-auto max-w-full rounded-xl bg-slate-950/78 backdrop-blur-md border border-white/15 px-3 py-1.5 shadow-sm text-center text-xs font-medium leading-relaxed text-white/95 line-clamp-2 [text-wrap:balance]"
                    : "mx-auto max-w-full rounded-xl bg-white/92 backdrop-blur-md border border-slate-200/85 px-3 py-1.5 shadow-xs text-center text-xs font-medium leading-relaxed text-slate-800 line-clamp-2 [text-wrap:balance]"
                }
              >
                {activeCaption}
              </p>
            </div>
          ))}
      </div>
    );
  }
);

XiaochunStage.displayName = "XiaochunStage";
