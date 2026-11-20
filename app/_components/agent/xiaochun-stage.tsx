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
  width?: number;
  height?: number;
  lazy?: boolean | "idle" | "click";
  scene?: "light" | "dark" | "transparent";
  outfit?: string;
  muted?: boolean;
  onMuteChange?: (muted: boolean) => void;
  className?: string;
}

function speakBrowserFallback(text: string): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "zh-CN";
    utterance.rate = 1.05;
    window.speechSynthesis.speak(utterance);
  } catch {
    // Ignore browser speech synthesis failures in headless / restricted environments
  }
}

function stopBrowserFallback(): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    // ignore
  }
}

export const XiaochunStage = React.forwardRef<XiaochunStageHandle, XiaochunStageProps>(
  function XiaochunStage(
    {
      title = "小蠢 · 3D 语音专员",
      subtitle = "支持语音受理与实时口型播报",
      caption,
      width = 280,
      height = 360,
      lazy = "click",
      scene = "light",
      outfit = "xiaochun_office_lady",
      muted,
      onMuteChange,
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
        stopBrowserFallback();
        setIsSpeaking(false);
        try {
          void xiaochunRef.current?.stop().catch(() => {});
        } catch {
          // ignore
        }
      }
    }, [isMuted]);

    useEffect(() => {
      return () => {
        stopBrowserFallback();
      };
    }, []);

    const handleActivate = useCallback(() => {
      setLoadError(null);
      setActivated(true);
      try {
        xiaochunRef.current?.activate();
      } catch {
        setLoadError("3D 形象暂时无法加载，已切换字幕与语音降级模式");
      }
    }, []);

    const handleStop = useCallback(() => {
      stopBrowserFallback();
      setIsSpeaking(false);
      try {
        void xiaochunRef.current?.stop().catch(() => {});
      } catch {
        // ignore
      }
    }, []);

    const handleSay = useCallback(async (text: string): Promise<void> => {
      const clean = (text || "").trim();
      if (!clean) return;
      setActiveCaption(clean);

      if (isMutedRef.current) {
        return;
      }

      if (isReadyRef.current && xiaochunRef.current) {
        try {
          setIsSpeaking(true);
          await xiaochunRef.current.say(clean, { mode: "speak" });
          setIsSpeaking(false);
          return;
        } catch {
          setIsSpeaking(false);
        }
      }

      speakBrowserFallback(clean);
    }, []);

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

    const isDark = scene === "dark";
    const shellBg =
      scene === "transparent"
        ? "bg-slate-50/70 border-slate-200/80 text-slate-900"
        : isDark
          ? "bg-slate-900 border-slate-700 text-slate-50"
          : "bg-slate-50 border-slate-200 text-slate-900";

    const overlayCardBg = isDark
      ? "bg-slate-900/90 border-slate-700 text-slate-100"
      : "bg-white/95 border-slate-200 text-slate-800";

    const embedSrc = process.env.NEXT_PUBLIC_XIAOCHUN_EMBED_URL || undefined;

    return (
      <div
        className={`relative overflow-hidden rounded-xl border shadow-sm select-none ${shellBg} ${className}`.trim()}
        style={{
          width: `${width}px`,
          maxWidth: "100%",
          height: `${height}px`,
        }}
        data-xiaochun-stage-status={ready ? "ready" : loadError ? "fallback" : activated ? "loading" : "standby"}
      >
        {/* 顶部紧凑信息与一键静音控制 */}
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
              <div
                className={`text-[11px] truncate ${
                  isDark ? "text-slate-400" : "text-slate-500"
                }`}
              >
                {subtitle}
              </div>
            ) : null}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={toggleMute}
              aria-pressed={isMuted}
              aria-label={isMuted ? "取消静音" : "一键静音"}
              title={isMuted ? "已静音，点击开启播报" : "点击静音"}
              className={`inline-flex items-center justify-center w-8 h-8 rounded-lg border text-xs transition-colors cursor-pointer ${
                isMuted
                  ? "bg-amber-50 border-amber-300 text-amber-700"
                  : isDark
                    ? "bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700"
                    : "bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200/70"
              }`}
            >
              {isMuted ? <VolumeX size={15} aria-hidden="true" /> : <Volume2 size={15} aria-hidden="true" />}
            </button>
          </div>
        </div>

        {/* 3D 形象挂载容器（固定宽高防 CLS） */}
        <Xiaochun
          ref={xiaochunRef}
          src={embedSrc}
          lang="zh-CN"
          outfit={outfit}
          scene={scene}
          controls={false}
          lazy={lazy}
          placeholder={false}
          width="100%"
          height={height}
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
            setActivated(true);
            setLoadError(null);
            setProgress(100);
            try {
              xiaochunRef.current?.setVolume(isMutedRef.current ? 0 : 1);
            } catch {
              // ignore
            }
          }}
          onUtterance={(u) => {
            if (u.phase === "start") setIsSpeaking(true);
            else if (u.phase === "end") setIsSpeaking(false);
          }}
          onError={(err) => {
            setIsSpeaking(false);
            setLoadError(err?.message || "3D 形象暂不可达，已启用字幕与语音降级");
          }}
        />

        {/* 待机 / 加载 / 异常降级遮罩卡片 */}
        {!ready && (
          <div className="absolute inset-0 z-10 flex items-center justify-center p-4 pt-14 pb-16 pointer-events-none">
            <div
              className={`pointer-events-auto w-full rounded-xl border px-3.5 py-4 text-center shadow-sm ${overlayCardBg}`}
            >
              <div
                className={`mx-auto mb-2.5 flex h-11 w-11 items-center justify-center rounded-full border ${
                  isDark
                    ? "bg-slate-800 border-slate-700 text-blue-400"
                    : "bg-blue-50 border-blue-100 text-blue-600"
                }`}
              >
                <Sparkles size={20} aria-hidden="true" />
              </div>

              {loadError ? (
                <>
                  <p className="text-xs font-semibold">3D 舞台离线降级模式</p>
                  <p
                    className={`mt-1 text-[11px] leading-relaxed ${
                      isDark ? "text-slate-400" : "text-slate-500"
                    }`}
                  >
                    {isMuted ? "当前已静音，仅实时显示回复字幕" : "字幕与语音播报正常可用"}
                  </p>
                  <button
                    type="button"
                    onClick={handleActivate}
                    className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                  >
                    <RefreshCw size={13} aria-hidden="true" />
                    重试连接 3D 形象
                  </button>
                </>
              ) : activated ? (
                <>
                  <p className="text-xs font-semibold">正在唤醒 3D 语音形象</p>
                  <p
                    className={`mt-1 text-[11px] tabular-nums ${
                      isDark ? "text-slate-400" : "text-slate-500"
                    }`}
                  >
                    {progress > 0 ? `资源加载中 ${progress}%` : "正在建立安全通信通道..."}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-xs font-semibold">3D 形象待机中</p>
                  <p
                    className={`mt-1 text-[11px] leading-relaxed ${
                      isDark ? "text-slate-400" : "text-slate-500"
                    }`}
                  >
                    可随时点击唤醒交互，未激活时亦支持字幕与语音播报
                  </p>
                  <button
                    type="button"
                    onClick={handleActivate}
                    className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 cursor-pointer"
                  >
                    <Play size={13} aria-hidden="true" />
                    激活 3D 客服形象
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* 底部实时字幕与静音状态条 */}
        {(activeCaption || isMuted || isSpeaking) && (
          <div className="absolute inset-x-2.5 bottom-2.5 z-20 pointer-events-none">
            <div
              role="status"
              aria-live="polite"
              className={`rounded-lg border px-2.5 py-2 text-xs leading-relaxed backdrop-blur-md shadow-sm ${
                isDark
                  ? "bg-slate-950/85 border-slate-700 text-slate-100"
                  : "bg-white/92 border-slate-200 text-slate-800"
              }`}
            >
              {isMuted && !activeCaption ? (
                <span className="text-[11px] text-amber-700 font-medium">
                  已静音 · 回复将以文字字幕呈现
                </span>
              ) : (
                <span className="line-clamp-3">
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
