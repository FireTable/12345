"use client";

import React, { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Xiaochun, type XiaochunHandle } from "@firetable/project-xiaochun/react";
import { Sparkles, Volume2, VolumeX, RefreshCw, Play } from "lucide-react";

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
  outfit?: string;
  muted?: boolean;
  onMuteChange?: (muted: boolean) => void;
  /**
   * card：带边框标题栏的小卡片（侧栏/弹窗内使用）。
   * stage：无边框大舞台，人物直接站在页面留白处，字幕以气泡浮在下方。
   */
  variant?: "card" | "stage";
  className?: string;
}

/** 大舞台取景：拉近镜头，让人物上半身占满留白（模块级常量，避免引用变化重建 iframe）。 */
const STAGE_CAMERA = { distance: 1.7, height: 0.15 } as const;

/** 首次说话时等待 3D 形象（含 SDK 内置 TTS）就绪的最长时间。 */
const READY_TIMEOUT_MS = 25_000;

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
      outfit = "xiaochun_office_lady",
      muted,
      onMuteChange,
      variant = "card",
      className = "",
    },
    ref
  ) {
    const xiaochunRef = useRef<XiaochunHandle | null>(null);
    const [internalMuted, setInternalMuted] = useState(false);
    const isMuted = muted ?? internalMuted;

    const [activated, setActivated] = useState<boolean>(lazy === false);
    const [ready, setReady] = useState<boolean>(false);
    const [progress, setProgress] = useState<number>(0);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
    const [activeCaption, setActiveCaption] = useState<string>(caption || "");

    const isReadyRef = useRef(ready);
    const isMutedRef = useRef(isMuted);
    isReadyRef.current = ready;
    isMutedRef.current = isMuted;

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
      try {
        xiaochunRef.current?.setVolume(isMuted ? 0 : 1);
      } catch {
        // ignore if not ready
      }
      if (isMuted) {
        setIsSpeaking(false);
        try {
          void xiaochunRef.current?.stop().catch(() => {});
        } catch {
          // ignore
        }
      }
    }, [isMuted]);

    useEffect(() => {
      return () => settleReadyWaiters(false);
    }, [settleReadyWaiters]);

    const handleActivate = useCallback(() => {
      setLoadError(null);
      setActivated(true);
      try {
        xiaochunRef.current?.activate();
      } catch {
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
      setIsSpeaking(false);
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
        if (isMutedRef.current) return;

        const token = ++sayTokenRef.current;
        if (!isReadyRef.current) {
          // 统一使用 SDK 内置 TTS（带口型与动作）；未加载时先唤醒，不再退回浏览器语音
          handleActivate();
          const ok = await waitUntilReady();
          if (!ok || token !== sayTokenRef.current || isMutedRef.current) return;
        }

        const handle = xiaochunRef.current;
        if (!handle) return;
        try {
          setIsSpeaking(true);
          await handle.say(clean, { mode: "speak" });
        } catch {
          // 播报失败时保留字幕即可
        } finally {
          if (token === sayTokenRef.current) setIsSpeaking(false);
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

    const toggleMute = () => {
      const next = !isMuted;
      if (muted === undefined) {
        setInternalMuted(next);
      }
      onMuteChange?.(next);
    };

    const isStage = variant === "stage";
    const isDark = scene === "dark";
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

    const muteButton = (
      <button
        type="button"
        onClick={toggleMute}
        aria-pressed={isMuted}
        aria-label={isMuted ? "取消静音" : "一键静音"}
        title={isMuted ? "已静音，点击开启播报" : "点击静音"}
        className={`inline-flex items-center justify-center ${isStage ? "w-11 h-11" : "w-9 h-9"} rounded-lg border text-xs transition-colors cursor-pointer ${
          isMuted
            ? "bg-amber-50 border-amber-300 text-amber-700"
            : isDark
              ? "bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700"
              : "bg-white/90 border-slate-200 text-slate-700 hover:bg-slate-100"
        }`}
      >
        {isMuted ? <VolumeX size={16} aria-hidden="true" /> : <Volume2 size={16} aria-hidden="true" />}
      </button>
    );

    return (
      <div
        className={`relative overflow-hidden select-none ${shellBg} ${className}`.trim()}
        style={{
          width: toCssLength(width),
          maxWidth: "100%",
          height: cssHeight,
        }}
        data-xiaochun-stage-status={ready ? "ready" : loadError ? "fallback" : activated ? "loading" : "standby"}
        data-xiaochun-variant={variant}
      >
        {isStage ? (
          <div className="absolute right-2 top-2 z-20">{muteButton}</div>
        ) : (
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
            <div className="flex items-center gap-1 shrink-0">{muteButton}</div>
          </div>
        )}

        {/* 3D 形象挂载容器（固定宽高防 CLS） */}
        <Xiaochun
          ref={xiaochunRef}
          src={embedSrc}
          lang="zh-CN"
          outfit={outfit}
          scene={isStage ? "transparent" : scene}
          camera={isStage ? STAGE_CAMERA : undefined}
          controls={false}
          lazy={lazy}
          placeholder={false}
          width="100%"
          height={cssHeight}
          handshakeTimeout={15000}
          onHandshake={() => {
            setLoadError(null);
            setActivated(true);
          }}
          onProgress={(p) => {
            if (p.phase === "model") {
              setProgress(Math.min(100, Math.max(0, Math.round(p.progress))));
            }
          }}
          onReady={() => {
            setReady(true);
            isReadyRef.current = true;
            setActivated(true);
            setLoadError(null);
            setProgress(100);
            try {
              xiaochunRef.current?.setVolume(isMutedRef.current ? 0 : 1);
            } catch {
              // ignore
            }
            settleReadyWaiters(true);
          }}
          onUtterance={(u) => {
            if (u.phase === "start") setIsSpeaking(true);
            else if (u.phase === "end") setIsSpeaking(false);
          }}
          onError={(err) => {
            setIsSpeaking(false);
            setLoadError(err?.message || "3D 形象暂不可达，回复将以字幕呈现");
            settleReadyWaiters(false);
          }}
        />

        {/* 待机 / 加载 / 异常降级提示 */}
        {!ready && (
          <div
            className={`absolute inset-0 z-10 flex items-center justify-center p-4 pointer-events-none ${
              isStage ? "" : "pt-14 pb-16"
            }`}
          >
            <div
              className={`pointer-events-auto w-full max-w-[280px] rounded-xl border px-3.5 py-4 text-center shadow-sm ${overlayCardBg}`}
            >
              <div
                className={`mx-auto mb-2.5 flex h-11 w-11 items-center justify-center rounded-full border ${
                  isDark ? "bg-slate-800 border-slate-700 text-blue-400" : "bg-blue-50 border-blue-100 text-blue-600"
                }`}
              >
                <Sparkles size={20} aria-hidden="true" />
              </div>

              {loadError ? (
                <>
                  <p className="text-xs font-semibold">3D 形象暂时离线</p>
                  <p className={`mt-1 text-[11px] leading-relaxed ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                    回复会以文字字幕呈现
                  </p>
                  <button
                    type="button"
                    onClick={handleActivate}
                    className="mt-3 inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                  >
                    <RefreshCw size={13} aria-hidden="true" />
                    重试连接 3D 形象
                  </button>
                </>
              ) : activated ? (
                <>
                  <p className="text-xs font-semibold">正在加载语音形象</p>
                  <p className={`mt-1 text-[11px] tabular-nums ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                    {progress > 0 ? `资源加载中 ${progress}%` : "正在建立安全通信通道..."}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-xs font-semibold">语音形象待机中</p>
                  <p className={`mt-1 text-[11px] leading-relaxed ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                    点击启动后，回复将以语音播报
                  </p>
                  <button
                    type="button"
                    onClick={handleActivate}
                    className="mt-3 inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 cursor-pointer"
                  >
                    <Play size={13} aria-hidden="true" />
                    启动语音形象
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* 实时字幕：card 为底部条，stage 为人物下方的对话气泡 */}
        {(activeCaption || isMuted || isSpeaking) && (
          <div
            className={`absolute z-20 pointer-events-none ${
              isStage ? "inset-x-3 bottom-3 sm:inset-x-6 sm:bottom-5" : "inset-x-2.5 bottom-2.5"
            }`}
          >
            <div
              role="status"
              aria-live="polite"
              className={`border backdrop-blur-md shadow-sm ${
                isStage
                  ? "mx-auto max-w-[520px] rounded-2xl px-4 py-3 text-sm leading-relaxed bg-white/90 border-slate-200 text-slate-800"
                  : `rounded-lg px-2.5 py-2 text-xs leading-relaxed ${
                      isDark
                        ? "bg-slate-950/85 border-slate-700 text-slate-100"
                        : "bg-white/92 border-slate-200 text-slate-800"
                    }`
              }`}
            >
              {isMuted && !activeCaption ? (
                <span className="text-[11px] text-amber-700 font-medium">已静音 · 回复将以文字字幕呈现</span>
              ) : (
                <span className={isStage ? "line-clamp-4" : "line-clamp-3"}>
                  {isMuted ? "[静音字幕] " : ""}
                  {activeCaption}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }
);

XiaochunStage.displayName = "XiaochunStage";
