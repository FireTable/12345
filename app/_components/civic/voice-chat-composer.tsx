"use client";

import React from "react";
import { Mic, RefreshCw, Send } from "lucide-react";
import "./voice-chat-composer.css";

export interface VoiceChatComposerAsrState {
  status: string;
  isRecording: boolean;
  audioLevel: number;
  downloadPercent: number;
  interimText: string;
  error: string | null;
  statusHint?: string | null;
}

export interface VoiceChatComposerProps {
  inputId: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
  placeholder: string;
  disabled?: boolean;
  micDisabled?: boolean;
  asr: VoiceChatComposerAsrState;
  onVoiceToggle: () => void | Promise<void>;
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
  submitAriaLabel?: string;
  compact?: boolean;
  className?: string;
}

export function VoiceChatComposer({
  inputId,
  label,
  value,
  onChange,
  onSubmit,
  placeholder,
  disabled = false,
  micDisabled = false,
  asr,
  onVoiceToggle,
  inputRef,
  submitAriaLabel = "发送消息",
  compact = false,
  className,
}: VoiceChatComposerProps) {
  const isBusyMic = asr.status === "initializing" || asr.status === "downloading";
  const canSend = Boolean(value.trim() || (asr.isRecording && asr.interimText.trim()));

  const resolvedPlaceholder = asr.isRecording
    ? asr.interimText
      ? `实时转写：${asr.interimText}`
      : "正在聆听，请直接说话…"
    : asr.status === "initializing"
      ? "正在打开麦克风…"
      : placeholder;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (e.nativeEvent.isComposing || e.keyCode === 229) {
        return;
      }
      if (!disabled && canSend) {
        void onSubmit();
      }
    }
  };

  return (
    <div
      className={`voice-composer-wrap${compact ? " voice-composer-wrap--compact" : ""}${
        className ? ` ${className}` : ""
      }`}
    >
      {(asr.status === "downloading" || Boolean(asr.error)) && (
        <div
          role={asr.error ? "status" : undefined}
          aria-live={asr.error ? "polite" : undefined}
          className="voice-composer__status"
        >
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 space-y-1.5">
            {asr.status === "downloading" && (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium text-slate-700">
                    {asr.statusHint || "正在准备本地语音识别…"}
                  </span>
                  <span className="font-mono tabular-nums text-blue-600 shrink-0">
                    {Math.round(asr.downloadPercent)}%
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full bg-blue-600 transition-all"
                    style={{ width: `${asr.downloadPercent}%` }}
                  />
                </div>
              </>
            )}
            {asr.error && <p className="text-amber-700 font-medium">{asr.error}</p>}
          </div>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!disabled && canSend) {
            void onSubmit();
          }
        }}
        className="voice-composer"
      >
        <label htmlFor={inputId} className="sr-only">
          {label}
        </label>
        <div className="voice-composer__box">
          <textarea
            ref={inputRef}
            id={inputId}
            rows={1}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={resolvedPlaceholder}
            className="voice-composer__input"
          />

          <div className="voice-composer__actions">
            <button
              type="button"
              disabled={micDisabled}
              onClick={() => void onVoiceToggle()}
              aria-pressed={asr.isRecording}
              title={asr.isRecording || isBusyMic ? "点击停止语音输入" : "点击开始语音输入"}
              aria-label={asr.isRecording || isBusyMic ? "停止语音输入" : "点击开始语音输入"}
              style={
                asr.isRecording
                  ? ({
                      "--mic-level": String(
                        Math.min(1, Math.max(0.2, asr.audioLevel * 1.8)).toFixed(2)
                      ),
                    } as React.CSSProperties)
                  : undefined
              }
              className={`voice-record-btn${
                asr.isRecording
                  ? " is-recording"
                  : isBusyMic
                    ? " is-initializing"
                    : ""
              }`}
            >
              {asr.isRecording ? (
                <span className="voice-eq-bars" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
              ) : isBusyMic ? (
                <RefreshCw size={15} className="motion-safe:animate-spin" aria-hidden="true" />
              ) : (
                <Mic size={17} aria-hidden="true" />
              )}
            </button>

            <button
              type="submit"
              disabled={disabled || !canSend}
              aria-label={submitAriaLabel}
              title={submitAriaLabel}
              className="voice-send-btn"
            >
              <Send size={15} aria-hidden="true" />
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
