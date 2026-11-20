"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DownloadProgressEvent,
  RecognizedEvent,
  RecognizingEvent,
  StreamRecognizer,
  VadStateChangeEvent,
} from "@firetable/stream-asr";

export type AsrBackendMode = "idle" | "stream-asr" | "web-speech" | "unsupported";
export type AsrStatus = "idle" | "downloading" | "initializing" | "recording" | "error";

export interface UseStreamAsrOptions {
  onFinalResult?: (text: string) => void;
  onInterimResult?: (text: string) => void;
}

export interface UseStreamAsrResult {
  status: AsrStatus;
  backend: AsrBackendMode;
  isRecording: boolean;
  isSupported: boolean;
  downloadPercent: number;
  vadState: string;
  audioLevel: number;
  interimText: string;
  finalText: string;
  error: string | null;
  statusHint: string;
  start: () => Promise<void>;
  stop: () => void;
  reset: () => void;
}

interface SpeechRecognitionResultAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionResultAlternativeLike;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}

interface SpeechRecognitionErrorEventLike {
  error: string;
  message?: string;
}

interface SpeechRecognitionInstance {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const win = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return win.SpeechRecognition || win.webkitSpeechRecognition || null;
}

function getAudioContextCtor(): typeof AudioContext | null {
  if (typeof window === "undefined") return null;
  const win = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  return win.AudioContext || win.webkitAudioContext || null;
}

function joinTranscriptParts(base: string, next: string): string {
  const cleanNext = next.trim();
  if (!cleanNext) return base;
  if (!base.trim()) return cleanNext;
  const endsWithPunct = /[，。！？、；：,.!?;:\s]$/.test(base);
  return endsWithPunct ? `${base}${cleanNext}` : `${base}，${cleanNext}`;
}

export function useStreamAsr(options?: UseStreamAsrOptions): UseStreamAsrResult {
  const [status, setStatus] = useState<AsrStatus>("idle");
  const [backend, setBackend] = useState<AsrBackendMode>("idle");
  const [isSupported, setIsSupported] = useState<boolean>(false);
  const [downloadPercent, setDownloadPercent] = useState<number>(0);
  const [vadState, setVadState] = useState<string>("SILENCE");
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [interimText, setInterimText] = useState<string>("");
  const [finalText, setFinalText] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [statusHint, setStatusHint] = useState<string>("点击麦克风开始语音输入");

  const onFinalRef = useRef(options?.onFinalResult);
  const onInterimRef = useRef(options?.onInterimResult);
  onFinalRef.current = options?.onFinalResult;
  onInterimRef.current = options?.onInterimResult;

  const recognizerRef = useRef<StreamRecognizer | null>(null);
  const streamAsrUnavailableRef = useRef<boolean>(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const silentGainRef = useRef<GainNode | null>(null);
  const speechRecRef = useRef<SpeechRecognitionInstance | null>(null);

  const sessionIdRef = useRef<number>(0);
  const recordingActiveRef = useRef<boolean>(false);
  const latestInterimRef = useRef<string>("");
  const committedSessionRef = useRef<boolean>(false);
  const lastLevelEmitRef = useRef<number>(0);
  const finalizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const hasWebAudio =
      typeof navigator !== "undefined" &&
      typeof navigator.mediaDevices?.getUserMedia === "function" &&
      Boolean(getAudioContextCtor());
    const hasWebSpeech = Boolean(getSpeechRecognitionCtor());
    setIsSupported(hasWebAudio || hasWebSpeech);
  }, []);

  const releaseAudioCapture = useCallback(() => {
    if (processorNodeRef.current) {
      processorNodeRef.current.onaudioprocess = null;
      try {
        processorNodeRef.current.disconnect();
      } catch {
        // ignore disconnect errors
      }
      processorNodeRef.current = null;
    }
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.disconnect();
      } catch {
        // ignore disconnect errors
      }
      sourceNodeRef.current = null;
    }
    if (silentGainRef.current) {
      try {
        silentGainRef.current.disconnect();
      } catch {
        // ignore disconnect errors
      }
      silentGainRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // ignore
        }
      });
      mediaStreamRef.current = null;
    }
    if (audioCtxRef.current) {
      const ctx = audioCtxRef.current;
      audioCtxRef.current = null;
      if (ctx.state !== "closed") {
        void ctx.close().catch(() => {});
      }
    }
    setAudioLevel(0);
  }, []);

  const releaseWebSpeech = useCallback(() => {
    if (speechRecRef.current) {
      const rec = speechRecRef.current;
      speechRecRef.current = null;
      rec.onstart = null;
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      try {
        rec.stop();
      } catch {
        try {
          rec.abort();
        } catch {
          // ignore
        }
      }
    }
  }, []);

  const commitFinalSegment = useCallback((rawText: string) => {
    const clean = rawText.trim();
    if (!clean) return;
    committedSessionRef.current = true;
    latestInterimRef.current = "";
    setInterimText("");
    setFinalText((prev) => joinTranscriptParts(prev, clean));
    onFinalRef.current?.(clean);
  }, []);

  const startWebSpeechFallback = useCallback(
    (sessionId: number, fallbackReason?: string): boolean => {
      const Ctor = getSpeechRecognitionCtor();
      if (!Ctor) return false;
      if (sessionId !== sessionIdRef.current) return false;

      releaseAudioCapture();
      releaseWebSpeech();

      const rec = new Ctor();
      rec.lang = "zh-CN";
      rec.interimResults = true;
      rec.continuous = true;
      rec.maxAlternatives = 1;
      speechRecRef.current = rec;

      let webSpeechCommittedUpTo = 0;

      rec.onstart = () => {
        if (sessionId !== sessionIdRef.current) return;
        recordingActiveRef.current = true;
        setBackend("web-speech");
        setStatus("recording");
        setError(null);
        setVadState("SPEECH");
        setStatusHint(
          fallbackReason
            ? `${fallbackReason}，已切换浏览器语音识别 (zh-CN)`
            : "正在聆听（浏览器原生语音识别 zh-CN）..."
        );
      };

      rec.onresult = (event: SpeechRecognitionEventLike) => {
        if (sessionId !== sessionIdRef.current) return;
        let interim = "";
        for (let i = Math.max(event.resultIndex, webSpeechCommittedUpTo); i < event.results.length; i++) {
          const result = event.results[i];
          const text = result?.[0]?.transcript || "";
          if (!text) continue;
          if (result.isFinal) {
            webSpeechCommittedUpTo = i + 1;
            commitFinalSegment(text);
          } else {
            interim += text;
          }
        }
        latestInterimRef.current = interim;
        setInterimText(interim);
        if (interim) {
          setVadState("SPEECH");
          onInterimRef.current?.(interim);
        }
      };

      rec.onerror = (event: SpeechRecognitionErrorEventLike) => {
        if (sessionId !== sessionIdRef.current) return;
        if (event.error === "aborted" && !recordingActiveRef.current) {
          return;
        }
        recordingActiveRef.current = false;
        const friendlyMap: Record<string, string> = {
          "not-allowed": "麦克风权限被拒绝，请在浏览器设置中允许麦克风访问",
          "service-not-allowed": "浏览器语音识别服务被禁用，请改用下方文字输入框",
          "audio-capture": "未检测到可用麦克风设备，请改用文字输入或演示快捷文本",
          "no-speech": "未检测到语音输入，请靠近麦克风重试",
          network: "浏览器语音服务网络不可达，请改用文字输入或演示快捷文本",
        };
        const msg = friendlyMap[event.error] || `语音识别异常（${event.error}）`;
        setError(msg);
        setStatus("error");
        setStatusHint(msg);
      };

      rec.onend = () => {
        if (sessionId !== sessionIdRef.current) return;
        if (latestInterimRef.current.trim() && !committedSessionRef.current) {
          commitFinalSegment(latestInterimRef.current);
        }
        recordingActiveRef.current = false;
        setVadState("SILENCE");
        setStatus((prev) => (prev === "error" ? "error" : "idle"));
        setStatusHint((prev) => (prev.includes("权限") || prev.includes("异常") ? prev : "语音识别已结束"));
      };

      try {
        rec.start();
        setBackend("web-speech");
        setStatus("recording");
        setStatusHint(
          fallbackReason
            ? `${fallbackReason}，正在启用浏览器语音识别...`
            : "正在启用浏览器语音识别..."
        );
        return true;
      } catch {
        releaseWebSpeech();
        return false;
      }
    },
    [commitFinalSegment, releaseAudioCapture, releaseWebSpeech]
  );

  const stop = useCallback(() => {
    const activeSession = sessionIdRef.current;
    recordingActiveRef.current = false;
    if (finalizeTimerRef.current) {
      clearTimeout(finalizeTimerRef.current);
      finalizeTimerRef.current = null;
    }

    releaseAudioCapture();

    if (speechRecRef.current) {
      const rec = speechRecRef.current;
      try {
        rec.stop();
      } catch {
        releaseWebSpeech();
      }
      setVadState("SILENCE");
      setStatus((prev) => (prev === "error" ? "error" : "idle"));
      setStatusHint("已停止语音输入");
      return;
    }

    const recognizer = recognizerRef.current;
    if (recognizer && recognizer.isReady) {
      try {
        recognizer.finish();
      } catch {
        // ignore finish errors
      }
      finalizeTimerRef.current = setTimeout(() => {
        if (sessionIdRef.current !== activeSession) return;
        if (!committedSessionRef.current && latestInterimRef.current.trim()) {
          commitFinalSegment(latestInterimRef.current);
        }
      }, 320);
    } else if (latestInterimRef.current.trim() && !committedSessionRef.current) {
      commitFinalSegment(latestInterimRef.current);
    }

    sessionIdRef.current += 1;
    setVadState("SILENCE");
    setStatus((prev) => (prev === "error" ? "error" : "idle"));
    setStatusHint("已停止语音输入");
  }, [commitFinalSegment, releaseAudioCapture, releaseWebSpeech]);

  const reset = useCallback(() => {
    sessionIdRef.current += 1;
    recordingActiveRef.current = false;
    committedSessionRef.current = false;
    latestInterimRef.current = "";
    if (finalizeTimerRef.current) {
      clearTimeout(finalizeTimerRef.current);
      finalizeTimerRef.current = null;
    }
    releaseAudioCapture();
    releaseWebSpeech();
    if (recognizerRef.current) {
      try {
        recognizerRef.current.reset();
      } catch {
        // ignore
      }
    }
    setInterimText("");
    setFinalText("");
    setError(null);
    setVadState("SILENCE");
    setAudioLevel(0);
    setStatus("idle");
    setStatusHint("点击麦克风开始语音输入");
  }, [releaseAudioCapture, releaseWebSpeech]);

  const start = useCallback(async () => {
    if (recordingActiveRef.current) return;
    if (typeof window === "undefined") return;

    if (finalizeTimerRef.current) {
      clearTimeout(finalizeTimerRef.current);
      finalizeTimerRef.current = null;
    }

    const sessionId = ++sessionIdRef.current;
    committedSessionRef.current = false;
    latestInterimRef.current = "";
    setInterimText("");
    setError(null);
    setVadState("SILENCE");

    const AudioCtx = getAudioContextCtor();
    const canCapturePcm =
      typeof navigator !== "undefined" &&
      typeof navigator.mediaDevices?.getUserMedia === "function" &&
      Boolean(AudioCtx);

    if (!canCapturePcm || streamAsrUnavailableRef.current) {
      const ok = startWebSpeechFallback(
        sessionId,
        !canCapturePcm ? "当前浏览器不支持音频流捕获" : "端侧模型离线"
      );
      if (!ok) {
        setBackend("unsupported");
        setStatus("error");
        const msg = "当前浏览器不支持语音识别，请改用下方文字输入框或演示快捷按钮";
        setError(msg);
        setStatusHint(msg);
      }
      return;
    }

    let mediaStream: MediaStream;
    let audioCtx: AudioContext;
    try {
      setStatus("initializing");
      setStatusHint("正在请求麦克风权限...");
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (sessionId !== sessionIdRef.current) {
        mediaStream.getTracks().forEach((t) => t.stop());
        return;
      }
      audioCtx = new AudioCtx!();
      if (audioCtx.state === "suspended") {
        await audioCtx.resume().catch(() => {});
      }
      mediaStreamRef.current = mediaStream;
      audioCtxRef.current = audioCtx;
    } catch (err: unknown) {
      if (sessionId !== sessionIdRef.current) return;
      const errName = err instanceof Error ? err.name : "";
      const msg =
        errName === "NotAllowedError" || errName === "PermissionDeniedError"
          ? "麦克风权限被拒绝，请在浏览器地址栏允许访问后重试，或使用文字输入"
          : errName === "NotFoundError" || errName === "DevicesNotFoundError"
            ? "未检测到可用麦克风设备，请改用文字输入或演示快捷文本"
            : "无法访问麦克风，请检查设备权限或改用文字输入";
      setStatus("error");
      setError(msg);
      setStatusHint(msg);
      return;
    }

    try {
      setBackend("stream-asr");
      let recognizer = recognizerRef.current;

      if (!recognizer) {
        const { StreamRecognizer: StreamRecognizerCtor } = await import("@firetable/stream-asr");
        if (sessionId !== sessionIdRef.current) {
          releaseAudioCapture();
          return;
        }
        recognizer = new StreamRecognizerCtor({
          modelUrl:
            process.env.NEXT_PUBLIC_STREAM_ASR_MODEL_URL ||
            "https://asr.firetable.tech/model_chunks/model.json",
          wasmBaseUrl:
            process.env.NEXT_PUBLIC_STREAM_ASR_WASM_URL ||
            "https://asr.firetable.tech/wasm",
          mode: 3,
          vadThreshold: 0.5,
          enableCache: true,
        });
        recognizerRef.current = recognizer;
      }

      const handleDownloadProgress = (ev: DownloadProgressEvent) => {
        if (sessionId !== sessionIdRef.current) return;
        const pct = Math.min(100, Math.max(0, Math.round(ev.percent || 0)));
        setDownloadPercent(pct);
        setStatus("downloading");
        setStatusHint(`正在加载端侧语音模型 (${pct}%)...`);
      };

      const handleRecognizing = (ev: RecognizingEvent) => {
        if (sessionId !== sessionIdRef.current) return;
        const text = (ev.text || "").trim();
        if (text) {
          latestInterimRef.current = text;
          setInterimText(text);
          onInterimRef.current?.(text);
        }
      };

      const handleRecognized = (ev: RecognizedEvent) => {
        const text = (ev.text || "").trim();
        if (text) {
          commitFinalSegment(text);
        } else if (latestInterimRef.current.trim() && !committedSessionRef.current) {
          commitFinalSegment(latestInterimRef.current);
        }
      };

      const handleVadStateChange = (ev: VadStateChangeEvent) => {
        if (sessionId !== sessionIdRef.current) return;
        setVadState(ev.stateName || "SILENCE");
      };

      const handleAsrError = (err: Error) => {
        if (sessionId !== sessionIdRef.current) return;
        console.warn("[useStreamAsr] Runtime error:", err?.message || err);
      };

      recognizer.on("download_progress", handleDownloadProgress);
      recognizer.on("recognizing", handleRecognizing);
      recognizer.on("recognized", handleRecognized);
      recognizer.on("vad_state_change", handleVadStateChange);
      recognizer.on("error", handleAsrError);

      try {
        if (!recognizer.isReady) {
          setStatus("downloading");
          setDownloadPercent(0);
          setStatusHint("正在初始化端侧流式语音引擎...");

          let lastActivityAt = Date.now();
          const bumpActivity = () => {
            lastActivityAt = Date.now();
          };
          recognizer.on("download_progress", bumpActivity);

          try {
            await new Promise<void>((resolve, reject) => {
              let settled = false;
              const watchdog = setInterval(() => {
                if (settled) return;
                if (sessionId !== sessionIdRef.current) {
                  settled = true;
                  clearInterval(watchdog);
                  reject(new Error("ASR initialization cancelled"));
                  return;
                }
                if (Date.now() - lastActivityAt > 15000) {
                  settled = true;
                  clearInterval(watchdog);
                  reject(new Error("Stream ASR model initialization timeout"));
                }
              }, 1000);

              recognizer!
                .init()
                .then(() => {
                  if (settled) return;
                  settled = true;
                  clearInterval(watchdog);
                  resolve();
                })
                .catch((e) => {
                  if (settled) return;
                  settled = true;
                  clearInterval(watchdog);
                  reject(e);
                });
            });
          } finally {
            recognizer.off("download_progress", bumpActivity);
          }
        } else {
          recognizer.reset();
        }
      } catch (initErr) {
        recognizer.off("download_progress", handleDownloadProgress);
        recognizer.off("recognizing", handleRecognizing);
        recognizer.off("recognized", handleRecognized);
        recognizer.off("vad_state_change", handleVadStateChange);
        recognizer.off("error", handleAsrError);
        try {
          recognizer.destroy();
        } catch {
          // ignore
        }
        recognizerRef.current = null;
        if (sessionId !== sessionIdRef.current) {
          releaseAudioCapture();
          return;
        }
        throw initErr;
      }

      if (sessionId !== sessionIdRef.current) {
        releaseAudioCapture();
        return;
      }

      setDownloadPercent(100);
      setStatus("recording");
      setStatusHint("正在聆听（端侧 Stream-ASR 实时识别）...");
      recordingActiveRef.current = true;

      const sourceNode = audioCtx.createMediaStreamSource(mediaStream);
      const processorNode = audioCtx.createScriptProcessor(2048, 1, 1);
      const silentGain = audioCtx.createGain();
      silentGain.gain.value = 0;

      sourceNodeRef.current = sourceNode;
      processorNodeRef.current = processorNode;
      silentGainRef.current = silentGain;

      processorNode.onaudioprocess = (event: AudioProcessingEvent) => {
        if (!recordingActiveRef.current || sessionId !== sessionIdRef.current) return;
        const input = event.inputBuffer.getChannelData(0);
        if (!input || input.length === 0) return;

        let sumSquares = 0;
        for (let i = 0; i < input.length; i++) {
          sumSquares += input[i] * input[i];
        }
        const rms = Math.sqrt(sumSquares / input.length);
        const normalizedLevel = Math.min(1, Math.max(0, rms * 4));
        const now = performance.now();
        if (now - lastLevelEmitRef.current >= 60) {
          lastLevelEmitRef.current = now;
          setAudioLevel(normalizedLevel);
        }

        if (recognizerRef.current?.isReady) {
          try {
            recognizerRef.current.feed(new Float32Array(input), audioCtx.sampleRate);
          } catch {
            // ignore feed errors during teardown
          }
        }
      };

      sourceNode.connect(processorNode);
      processorNode.connect(silentGain);
      silentGain.connect(audioCtx.destination);
    } catch {
      if (sessionId !== sessionIdRef.current) {
        releaseAudioCapture();
        return;
      }
      streamAsrUnavailableRef.current = true;
      const fallbackOk = startWebSpeechFallback(sessionId, "端侧模型离线或不可达");
      if (!fallbackOk) {
        releaseAudioCapture();
        setBackend("unsupported");
        setStatus("error");
        const msg = "端侧语音模型不可用，且浏览器不支持原生语音识别，请改用文字输入或演示快捷文本";
        setError(msg);
        setStatusHint(msg);
      }
    }
  }, [commitFinalSegment, releaseAudioCapture, startWebSpeechFallback]);

  useEffect(() => {
    return () => {
      sessionIdRef.current += 1;
      recordingActiveRef.current = false;
      if (finalizeTimerRef.current) {
        clearTimeout(finalizeTimerRef.current);
        finalizeTimerRef.current = null;
      }
      releaseAudioCapture();
      releaseWebSpeech();
      if (recognizerRef.current) {
        try {
          recognizerRef.current.destroy();
        } catch {
          // ignore
        }
        recognizerRef.current = null;
      }
    };
  }, [releaseAudioCapture, releaseWebSpeech]);

  return {
    status,
    backend,
    isRecording: status === "recording",
    isSupported,
    downloadPercent,
    vadState,
    audioLevel,
    interimText,
    finalText,
    error,
    statusHint,
    start,
    stop,
    reset,
  };
}
