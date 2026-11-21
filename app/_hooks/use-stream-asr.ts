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
export type AsrLifecyclePhase = "idle" | "starting" | "recording" | "stopping";

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

export interface SpeechRecognitionResultAlternativeLike {
  transcript: string;
}

export interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionResultAlternativeLike;
}

export interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}

export interface SpeechRecognitionErrorEventLike {
  error: string;
  message?: string;
}

export interface SpeechRecognitionInstance {
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

export type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

export interface StreamRecognizerLike {
  readonly isReady: boolean;
  on(event: "download_progress", listener: (ev: DownloadProgressEvent) => void): void;
  on(event: "recognizing", listener: (ev: RecognizingEvent) => void): void;
  on(event: "recognized", listener: (ev: RecognizedEvent) => void): void;
  on(event: "vad_state_change", listener: (ev: VadStateChangeEvent) => void): void;
  on(event: "error", listener: (err: Error) => void): void;
  off(event: "download_progress", listener: (ev: DownloadProgressEvent) => void): void;
  off(event: "recognizing", listener: (ev: RecognizingEvent) => void): void;
  off(event: "recognized", listener: (ev: RecognizedEvent) => void): void;
  off(event: "vad_state_change", listener: (ev: VadStateChangeEvent) => void): void;
  off(event: "error", listener: (err: Error) => void): void;
  init(): Promise<void>;
  feed(inputPcm: Float32Array, inputSampleRate?: number, isFinal?: boolean): void;
  finish(): void;
  reset(): void;
  destroy(): void;
}

export interface AudioWorkletNodeLike {
  port: {
    onmessage: ((event: MessageEvent) => void) | null;
    postMessage: (message: unknown) => void;
  };
  connect: (destination: unknown) => unknown;
  disconnect: () => void;
}

export interface ScriptProcessorNodeLike {
  onaudioprocess: ((event: AudioProcessingEvent) => void) | null;
  connect: (destination: unknown) => unknown;
  disconnect: () => void;
}

export interface AudioNodeLike {
  connect: (destination: unknown) => unknown;
  disconnect: () => void;
}

export interface AudioContextLike {
  readonly sampleRate: number;
  readonly state: string;
  readonly destination: unknown;
  audioWorklet?: {
    addModule: (moduleURL: string) => Promise<void>;
  };
  resume: () => Promise<void>;
  close: () => Promise<void>;
  createMediaStreamSource: (stream: MediaStream) => AudioNodeLike;
  createScriptProcessor: (
    bufferSize?: number,
    numberOfInputChannels?: number,
    numberOfOutputChannels?: number
  ) => ScriptProcessorNodeLike;
  createGain: () => AudioNodeLike & { gain: { value: number } };
}

export type AudioCaptureMode = "worklet" | "script-processor";

export interface AudioCaptureCleanup {
  mode: AudioCaptureMode;
  cleanup: () => void;
}

export interface SetupAudioCaptureOptions {
  audioCtx: AudioContextLike;
  mediaStream: MediaStream;
  workletModuleUrl?: string;
  chunkSize?: number;
  isSessionActive: () => boolean;
  onSamples: (samples: Float32Array) => void;
  createWorkletNode?: (
    ctx: AudioContextLike,
    processorName: string,
    options: {
      numberOfInputs: number;
      numberOfOutputs: number;
      channelCount: number;
      processorOptions: { chunkSize: number };
    }
  ) => AudioWorkletNodeLike;
}

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const win = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return win.SpeechRecognition || win.webkitSpeechRecognition || null;
}

function getAudioContextCtor(): (new () => AudioContextLike) | null {
  if (typeof window === "undefined") return null;
  const win = window as unknown as {
    AudioContext?: new () => AudioContextLike;
    webkitAudioContext?: new () => AudioContextLike;
  };
  return win.AudioContext || win.webkitAudioContext || null;
}

export function joinTranscriptParts(base: string, next: string): string {
  const cleanNext = next.trim();
  if (!cleanNext) return base;
  if (!base.trim()) return cleanNext;
  const endsWithPunct = /[，。！？、；：,.!?;:\s]$/.test(base);
  return endsWithPunct ? `${base}${cleanNext}` : `${base}，${cleanNext}`;
}

export async function setupAudioCaptureGraph(
  options: SetupAudioCaptureOptions
): Promise<AudioCaptureCleanup | null> {
  const {
    audioCtx,
    mediaStream,
    workletModuleUrl = "/civic/asr-worklet.js",
    chunkSize = 1024,
    isSessionActive,
    onSamples,
    createWorkletNode,
  } = options;

  const sourceNode = audioCtx.createMediaStreamSource(mediaStream);
  const silentGain = audioCtx.createGain();
  silentGain.gain.value = 0;

  const defaultCreateWorkletNode = (
    ctx: AudioContextLike,
    processorName: string,
    opts: {
      numberOfInputs: number;
      numberOfOutputs: number;
      channelCount: number;
      processorOptions: { chunkSize: number };
    }
  ): AudioWorkletNodeLike => {
    return new AudioWorkletNode(
      ctx as unknown as AudioContext,
      processorName,
      opts
    ) as unknown as AudioWorkletNodeLike;
  };

  const workletFactory =
    createWorkletNode ||
    (typeof AudioWorkletNode !== "undefined" ? defaultCreateWorkletNode : null);

  if (
    workletFactory &&
    audioCtx.audioWorklet &&
    typeof audioCtx.audioWorklet.addModule === "function"
  ) {
    try {
      await audioCtx.audioWorklet.addModule(workletModuleUrl);
      if (!isSessionActive()) {
        try {
          sourceNode.disconnect();
        } catch {}
        try {
          silentGain.disconnect();
        } catch {}
        return null;
      }
      const workletNode = workletFactory(audioCtx, "civic-asr-processor", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
        processorOptions: { chunkSize },
      });

      workletNode.port.onmessage = (event: MessageEvent) => {
        if (!isSessionActive()) return;
        const payload = event?.data;
        const samples =
          payload instanceof Float32Array
            ? payload
            : payload instanceof ArrayBuffer
              ? new Float32Array(payload)
              : ArrayBuffer.isView(payload)
                ? new Float32Array(payload.buffer, payload.byteOffset, Math.floor(payload.byteLength / 4))
                : null;
        if (!samples || samples.length === 0) return;
        onSamples(samples);
      };

      sourceNode.connect(workletNode);
      workletNode.connect(silentGain);
      silentGain.connect(audioCtx.destination);

      return {
        mode: "worklet",
        cleanup: () => {
          // Notify CivicAsrProcessor to set _active = false and stop its audio thread.
          // Intentionally clear port.onmessage and release track/AudioContext synchronously
          // so rapid stop() -> start() cycles remain 100% race-free; any <64ms post-stop
          // hardware tail in the worklet ring is dropped in favor of hasPendingInterim + finalizeTimer.
          try {
            workletNode.port.postMessage("stop");
          } catch {}
          workletNode.port.onmessage = null;
          try {
            workletNode.disconnect();
          } catch {}
          try {
            sourceNode.disconnect();
          } catch {}
          try {
            silentGain.disconnect();
          } catch {}
        },
      };
    } catch {
      // Silently fall back to ScriptProcessorNode (zero console.error)
    }
  }

  if (!isSessionActive()) {
    try {
      sourceNode.disconnect();
    } catch {}
    try {
      silentGain.disconnect();
    } catch {}
    return null;
  }

  const processorNode = audioCtx.createScriptProcessor(2048, 1, 1);
  processorNode.onaudioprocess = (event: AudioProcessingEvent) => {
    if (!isSessionActive()) return;
    const input = event.inputBuffer.getChannelData(0);
    if (!input || input.length === 0) return;
    onSamples(new Float32Array(input));
  };

  sourceNode.connect(processorNode);
  processorNode.connect(silentGain);
  silentGain.connect(audioCtx.destination);

  return {
    mode: "script-processor",
    cleanup: () => {
      processorNode.onaudioprocess = null;
      try {
        processorNode.disconnect();
      } catch {}
      try {
        sourceNode.disconnect();
      } catch {}
      try {
        silentGain.disconnect();
      } catch {}
    },
  };
}

export interface StreamAsrControllerDeps {
  setStatus: (next: AsrStatus | ((prev: AsrStatus) => AsrStatus)) => void;
  setBackend: (next: AsrBackendMode) => void;
  setDownloadPercent: (next: number) => void;
  setVadState: (next: string) => void;
  setAudioLevel: (next: number) => void;
  setInterimText: (next: string) => void;
  setFinalText: (next: string | ((prev: string) => string)) => void;
  setError: (next: string | null) => void;
  setStatusHint: (next: string | ((prev: string) => string)) => void;
  getOnFinal?: () => ((text: string) => void) | undefined;
  getOnInterim?: () => ((text: string) => void) | undefined;
  requestMicrophone?: () => Promise<MediaStream>;
  createAudioContext?: () => AudioContextLike | null;
  hasPcmCaptureSupport?: () => boolean;
  getSpeechRecognitionCtor?: () => SpeechRecognitionCtor | null;
  loadStreamRecognizerCtor?: () => Promise<
    new (options: {
      modelUrl: string;
      wasmBaseUrl: string;
      mode: number;
      vadThreshold: number;
      enableCache: boolean;
    }) => StreamRecognizerLike
  >;
  createWorkletNode?: SetupAudioCaptureOptions["createWorkletNode"];
  workletModuleUrl?: string;
  finalizeTimeoutMs?: number;
  initTimeoutMs?: number;
  now?: () => number;
}

export interface StreamAsrController {
  start: () => Promise<void>;
  stop: () => void;
  reset: () => void;
  destroy: () => void;
  getCaptureMode: () => AudioCaptureMode | null;
  getPhase: () => AsrLifecyclePhase;
  isStreamAsrUnavailable: () => boolean;
}

export function createStreamAsrController(deps: StreamAsrControllerDeps): StreamAsrController {
  const {
    setStatus,
    setBackend,
    setDownloadPercent,
    setVadState,
    setAudioLevel,
    setInterimText,
    setFinalText,
    setError,
    setStatusHint,
    getOnFinal,
    getOnInterim,
    requestMicrophone = () =>
      navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      }),
    createAudioContext = () => {
      const AudioCtx = getAudioContextCtor();
      return AudioCtx ? new AudioCtx() : null;
    },
    hasPcmCaptureSupport,
    getSpeechRecognitionCtor: resolveSpeechCtor = getSpeechRecognitionCtor,
    loadStreamRecognizerCtor = async () => {
      const mod = await import("@firetable/stream-asr");
      return mod.StreamRecognizer as unknown as new (options: {
        modelUrl: string;
        wasmBaseUrl: string;
        mode: number;
        vadThreshold: number;
        enableCache: boolean;
      }) => StreamRecognizerLike;
    },
    createWorkletNode,
    workletModuleUrl = "/civic/asr-worklet.js",
    finalizeTimeoutMs = 320,
    initTimeoutMs = 15000,
    now = () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
  } = deps;

  let recognizer: StreamRecognizerLike | null = null;
  let streamAsrUnavailable = false;
  let audioCtx: AudioContextLike | null = null;
  let mediaStream: MediaStream | null = null;
  let captureCleanup: AudioCaptureCleanup | null = null;
  let speechRec: SpeechRecognitionInstance | null = null;

  let sessionId = 0;
  let activePhase: AsrLifecyclePhase = "idle";
  let recordingActive = false;
  let latestInterim = "";
  let hasPendingInterim = false;
  let lastLevelEmit = 0;
  let finalizeTimer: ReturnType<typeof setTimeout> | null = null;
  let detachListeners: (() => void) | null = null;
  let startingCleanup: (() => void) | null = null;

  const clearFinalizeTimer = () => {
    if (finalizeTimer !== null) {
      clearTimeout(finalizeTimer);
      finalizeTimer = null;
    }
  };

  const detachRecognizerListeners = () => {
    if (detachListeners) {
      try {
        detachListeners();
      } catch {
        // ignore
      }
      detachListeners = null;
    }
  };

  const releaseAudioCapture = () => {
    if (captureCleanup) {
      try {
        captureCleanup.cleanup();
      } catch {
        // ignore
      }
      captureCleanup = null;
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // ignore
        }
      });
      mediaStream = null;
    }
    if (audioCtx) {
      const ctx = audioCtx;
      audioCtx = null;
      if (ctx.state !== "closed") {
        void ctx.close().catch(() => {});
      }
    }
    setAudioLevel(0);
  };

  const releaseWebSpeech = () => {
    if (speechRec) {
      const rec = speechRec;
      speechRec = null;
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
  };

  const commitFinalSegment = (rawText: string) => {
    const clean = rawText.trim();
    if (!clean) return;
    hasPendingInterim = false;
    latestInterim = "";
    setInterimText("");
    setFinalText((prev) => joinTranscriptParts(prev, clean));
    getOnFinal?.()?.(clean);
  };

  const startWebSpeechFallback = (targetSessionId: number, fallbackReason?: string): boolean => {
    const Ctor = resolveSpeechCtor();
    if (!Ctor) return false;
    if (targetSessionId !== sessionId) return false;

    detachRecognizerListeners();
    releaseAudioCapture();
    releaseWebSpeech();

    const rec = new Ctor();
    rec.lang = "zh-CN";
    rec.interimResults = true;
    rec.continuous = true;
    rec.maxAlternatives = 1;
    speechRec = rec;

    let webSpeechCommittedUpTo = 0;

    rec.onstart = () => {
      if (targetSessionId !== sessionId) return;
      recordingActive = true;
      activePhase = "recording";
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
      if (targetSessionId !== sessionId) return;
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
      latestInterim = interim;
      hasPendingInterim = Boolean(interim.trim());
      setInterimText(interim);
      if (interim) {
        setVadState("SPEECH");
        getOnInterim?.()?.(interim);
      }
    };

    rec.onerror = (event: SpeechRecognitionErrorEventLike) => {
      if (targetSessionId !== sessionId) return;
      if (event.error === "aborted" && !recordingActive) {
        return;
      }
      recordingActive = false;
      activePhase = "idle";
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
      if (targetSessionId !== sessionId) return;
      if (hasPendingInterim && latestInterim.trim()) {
        commitFinalSegment(latestInterim);
      }
      recordingActive = false;
      activePhase = "idle";
      speechRec = null;
      setVadState("SILENCE");
      setStatus((prev) => (prev === "error" ? "error" : "idle"));
      setStatusHint((prev) =>
        prev.includes("权限") || prev.includes("异常") ? prev : "语音识别已结束"
      );
    };

    try {
      rec.start();
      activePhase = "recording";
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
  };

  const stop = () => {
    if (activePhase === "idle" || activePhase === "stopping") return;
    const prevPhase = activePhase;
    const activeSession = sessionId;

    recordingActive = false;
    clearFinalizeTimer();
    const pendingStartingCleanup = startingCleanup;
    startingCleanup = null;
    pendingStartingCleanup?.();
    releaseAudioCapture();

    if (speechRec) {
      activePhase = "idle";
      if (hasPendingInterim && latestInterim.trim()) {
        commitFinalSegment(latestInterim);
      }
      sessionId += 1;
      releaseWebSpeech();
      setVadState("SILENCE");
      setStatus((prev) => (prev === "error" ? "error" : "idle"));
      setStatusHint("已停止语音输入");
      return;
    }

    if (prevPhase === "starting" || !(recognizer && recognizer.isReady)) {
      sessionId += 1;
      activePhase = "idle";
      detachRecognizerListeners();
      if (hasPendingInterim && latestInterim.trim()) {
        commitFinalSegment(latestInterim);
      }
      setVadState("SILENCE");
      setStatus((prev) => (prev === "error" ? "error" : "idle"));
      setStatusHint("已停止语音输入");
      return;
    }

    activePhase = "stopping";
    setVadState("SILENCE");
    setStatus((prev) => (prev === "error" ? "error" : "idle"));
    setStatusHint("已停止语音输入");

    try {
      recognizer.finish();
    } catch {
      // ignore finish errors
    }

    // If finish() synchronously emitted recognized and finalized, do not schedule timer
    if (activePhase !== "stopping" || sessionId !== activeSession) {
      return;
    }

    finalizeTimer = setTimeout(() => {
      finalizeTimer = null;
      if (sessionId !== activeSession) return;
      if (hasPendingInterim && latestInterim.trim()) {
        commitFinalSegment(latestInterim);
      }
      activePhase = "idle";
      sessionId += 1;
      detachRecognizerListeners();
    }, finalizeTimeoutMs);
  };

  const reset = () => {
    sessionId += 1;
    activePhase = "idle";
    recordingActive = false;
    hasPendingInterim = false;
    latestInterim = "";
    streamAsrUnavailable = false;
    clearFinalizeTimer();
    const pendingStartingCleanup = startingCleanup;
    startingCleanup = null;
    pendingStartingCleanup?.();
    detachRecognizerListeners();
    releaseAudioCapture();
    releaseWebSpeech();
    if (recognizer) {
      try {
        recognizer.reset();
      } catch {
        // ignore
      }
    }
    setBackend("idle");
    setDownloadPercent(0);
    setInterimText("");
    setFinalText("");
    setError(null);
    setVadState("SILENCE");
    setAudioLevel(0);
    setStatus("idle");
    setStatusHint("点击麦克风开始语音输入");
  };

  const start = async () => {
    if (activePhase === "recording" || activePhase === "starting") return;
    if (typeof window === "undefined" && !deps.createAudioContext && !deps.requestMicrophone) {
      return;
    }

    if (activePhase === "stopping") {
      clearFinalizeTimer();
      if (hasPendingInterim && latestInterim.trim()) {
        commitFinalSegment(latestInterim);
      }
      detachRecognizerListeners();
      activePhase = "idle";
    } else {
      clearFinalizeTimer();
    }

    const currentSessionId = ++sessionId;
    activePhase = "starting";
    hasPendingInterim = false;
    latestInterim = "";
    setInterimText("");
    setError(null);
    setVadState("SILENCE");

    const canCapturePcm = hasPcmCaptureSupport
      ? hasPcmCaptureSupport()
      : (Boolean(deps.requestMicrophone) ||
          (typeof navigator !== "undefined" &&
            typeof navigator.mediaDevices?.getUserMedia === "function")) &&
        (Boolean(deps.createAudioContext) || Boolean(getAudioContextCtor()));

    if (!canCapturePcm || streamAsrUnavailable) {
      const ok = startWebSpeechFallback(
        currentSessionId,
        !canCapturePcm ? "当前浏览器不支持音频流捕获" : "端侧模型离线"
      );
      if (!ok) {
        activePhase = "idle";
        setBackend("unsupported");
        setStatus("error");
        const msg = "当前浏览器不支持语音识别，请改用下方文字输入框或演示快捷按钮";
        setError(msg);
        setStatusHint(msg);
      }
      return;
    }

    let acquiredStream: MediaStream | null = null;
    let acquiredCtx: AudioContextLike | null = null;
    let localCaptureCleanup: AudioCaptureCleanup | null = null;
    let detachLocalListeners: (() => void) | null = null;
    let localUncommittedRecognizer: StreamRecognizerLike | null = null;

    const cleanupLocalOnly = () => {
      if (localCaptureCleanup) {
        try {
          localCaptureCleanup.cleanup();
        } catch {
          // ignore
        }
        localCaptureCleanup = null;
      }
      if (detachLocalListeners) {
        try {
          detachLocalListeners();
        } catch {
          // ignore
        }
        detachLocalListeners = null;
      }
      if (acquiredStream) {
        const stream = acquiredStream;
        acquiredStream = null;
        stream.getTracks().forEach((t) => {
          try {
            t.stop();
          } catch {
            // ignore
          }
        });
      }
      if (acquiredCtx) {
        const ctx = acquiredCtx;
        acquiredCtx = null;
        if (ctx.state !== "closed") {
          void ctx.close().catch(() => {});
        }
      }
      if (localUncommittedRecognizer && localUncommittedRecognizer !== recognizer) {
        const uncommitted = localUncommittedRecognizer;
        localUncommittedRecognizer = null;
        try {
          uncommitted.destroy();
        } catch {
          // ignore
        }
      } else {
        localUncommittedRecognizer = null;
      }
    };

    const clearIfOwnedStartingCleanup = () => {
      if (startingCleanup === cleanupLocalOnly) {
        startingCleanup = null;
      }
    };

    startingCleanup = cleanupLocalOnly;

    try {
      setStatus("initializing");
      setStatusHint("正在请求麦克风权限...");
      const stream = await requestMicrophone();
      acquiredStream = stream;
      if (currentSessionId !== sessionId) {
        cleanupLocalOnly();
        clearIfOwnedStartingCleanup();
        return;
      }
      const ctx = createAudioContext();
      if (!ctx) {
        cleanupLocalOnly();
        clearIfOwnedStartingCleanup();
        throw new Error("AudioContext unavailable");
      }
      acquiredCtx = ctx;
      if (acquiredCtx.state === "suspended") {
        await acquiredCtx.resume().catch(() => {});
      }
      if (currentSessionId !== sessionId) {
        cleanupLocalOnly();
        clearIfOwnedStartingCleanup();
        return;
      }
    } catch (err: unknown) {
      cleanupLocalOnly();
      if (currentSessionId !== sessionId) {
        clearIfOwnedStartingCleanup();
        return;
      }
      clearIfOwnedStartingCleanup();
      activePhase = "idle";
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
      let activeRecognizer = recognizer && recognizer.isReady ? recognizer : null;

      if (!activeRecognizer) {
        const StreamRecognizerCtor = await loadStreamRecognizerCtor();
        if (currentSessionId !== sessionId) {
          cleanupLocalOnly();
          clearIfOwnedStartingCleanup();
          return;
        }
        activeRecognizer = new StreamRecognizerCtor({
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
        localUncommittedRecognizer = activeRecognizer;
      }

      let lastActivityAt = Date.now();

      const handleDownloadProgress = (ev: DownloadProgressEvent) => {
        if (currentSessionId !== sessionId) return;
        lastActivityAt = Date.now();
        const pct = Math.min(100, Math.max(0, Math.round(ev.percent || 0)));
        setDownloadPercent(pct);
        setStatus("downloading");
        setStatusHint(`正在加载端侧语音模型 (${pct}%)...`);
      };

      const handleRecognizing = (ev: RecognizingEvent) => {
        if (currentSessionId !== sessionId) return;
        const text = (ev.text || "").trim();
        if (text) {
          latestInterim = text;
          hasPendingInterim = true;
          setInterimText(text);
          getOnInterim?.()?.(text);
        }
      };

      const handleRecognized = (ev: RecognizedEvent) => {
        if (currentSessionId !== sessionId) return;
        const text = (ev.text || "").trim();
        if (text) {
          commitFinalSegment(text);
        } else if (hasPendingInterim && latestInterim.trim()) {
          commitFinalSegment(latestInterim);
        }
        if (activePhase === "stopping") {
          clearFinalizeTimer();
          activePhase = "idle";
          sessionId += 1;
          detachRecognizerListeners();
        }
      };

      const handleVadStateChange = (ev: VadStateChangeEvent) => {
        if (currentSessionId !== sessionId) return;
        setVadState(ev.stateName || "SILENCE");
      };

      const handleAsrError = (err: Error) => {
        if (currentSessionId !== sessionId) return;
        console.warn("[useStreamAsr] Runtime error:", err?.message || err);
      };

      const boundRecognizer = activeRecognizer;
      boundRecognizer.on("download_progress", handleDownloadProgress);
      boundRecognizer.on("recognizing", handleRecognizing);
      boundRecognizer.on("recognized", handleRecognized);
      boundRecognizer.on("vad_state_change", handleVadStateChange);
      boundRecognizer.on("error", handleAsrError);

      detachLocalListeners = () => {
        boundRecognizer.off("download_progress", handleDownloadProgress);
        boundRecognizer.off("recognizing", handleRecognizing);
        boundRecognizer.off("recognized", handleRecognized);
        boundRecognizer.off("vad_state_change", handleVadStateChange);
        boundRecognizer.off("error", handleAsrError);
      };

      try {
        if (!boundRecognizer.isReady) {
          setStatus("downloading");
          setDownloadPercent(0);
          setStatusHint("正在初始化端侧流式语音引擎...");
          lastActivityAt = Date.now();

          await new Promise<void>((resolve, reject) => {
            let settled = false;
            const watchdog = setInterval(() => {
              if (settled) return;
              if (currentSessionId !== sessionId) {
                settled = true;
                clearInterval(watchdog);
                reject(new Error("ASR initialization cancelled"));
                return;
              }
              if (Date.now() - lastActivityAt > initTimeoutMs) {
                settled = true;
                clearInterval(watchdog);
                reject(new Error("Stream ASR model initialization timeout"));
              }
            }, 1000);

            boundRecognizer
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
        } else {
          boundRecognizer.reset();
        }
      } catch (initErr) {
        cleanupLocalOnly();
        if (currentSessionId !== sessionId) {
          clearIfOwnedStartingCleanup();
          return;
        }
        clearIfOwnedStartingCleanup();
        try {
          boundRecognizer.destroy();
        } catch {
          // ignore
        }
        if (recognizer === boundRecognizer) {
          recognizer = null;
        }
        throw initErr;
      }

      if (currentSessionId !== sessionId) {
        cleanupLocalOnly();
        clearIfOwnedStartingCleanup();
        return;
      }

      // Only cache recognizer after init() succeeded and this session is still current
      recognizer = boundRecognizer;
      localUncommittedRecognizer = null;

      if (!acquiredCtx || !acquiredStream) {
        cleanupLocalOnly();
        clearIfOwnedStartingCleanup();
        return;
      }

      const captureSampleRate = acquiredCtx.sampleRate;
      const cleanup = await setupAudioCaptureGraph({
        audioCtx: acquiredCtx,
        mediaStream: acquiredStream,
        workletModuleUrl,
        chunkSize: 1024,
        createWorkletNode,
        isSessionActive: () => currentSessionId === sessionId,
        onSamples: (samples) => {
          if (!recordingActive || currentSessionId !== sessionId) return;
          let sumSquares = 0;
          for (let i = 0; i < samples.length; i++) {
            sumSquares += samples[i] * samples[i];
          }
          const rms = Math.sqrt(sumSquares / samples.length);
          const normalizedLevel = Math.min(1, Math.max(0, rms * 4));
          const ts = now();
          if (ts - lastLevelEmit >= 60) {
            lastLevelEmit = ts;
            setAudioLevel(normalizedLevel);
          }

          if (boundRecognizer.isReady) {
            try {
              boundRecognizer.feed(samples, captureSampleRate);
            } catch {
              // ignore feed errors during teardown
            }
          }
        },
      });
      localCaptureCleanup = cleanup;

      if (currentSessionId !== sessionId || !cleanup) {
        cleanupLocalOnly();
        clearIfOwnedStartingCleanup();
        return;
      }

      // Atomically commit local resources to shared controller state (no awaits follow)
      clearIfOwnedStartingCleanup();
      detachRecognizerListeners();
      mediaStream = acquiredStream;
      audioCtx = acquiredCtx;
      captureCleanup = cleanup;
      detachListeners = detachLocalListeners;
      acquiredStream = null;
      acquiredCtx = null;
      localCaptureCleanup = null;
      detachLocalListeners = null;

      setDownloadPercent(100);
      setStatus("recording");
      setStatusHint("正在聆听（端侧 Stream-ASR 实时识别）...");
      recordingActive = true;
      activePhase = "recording";
    } catch {
      cleanupLocalOnly();
      if (currentSessionId !== sessionId) {
        clearIfOwnedStartingCleanup();
        return;
      }
      clearIfOwnedStartingCleanup();
      streamAsrUnavailable = true;
      const fallbackOk = startWebSpeechFallback(currentSessionId, "端侧模型离线或不可达");
      if (!fallbackOk) {
        releaseAudioCapture();
        activePhase = "idle";
        setBackend("unsupported");
        setStatus("error");
        const msg = "端侧语音模型不可用，且浏览器不支持原生语音识别，请改用文字输入或演示快捷文本";
        setError(msg);
        setStatusHint(msg);
      }
    }
  };

  const destroy = () => {
    sessionId += 1;
    activePhase = "idle";
    recordingActive = false;
    hasPendingInterim = false;
    latestInterim = "";
    clearFinalizeTimer();
    const pendingStartingCleanup = startingCleanup;
    startingCleanup = null;
    pendingStartingCleanup?.();
    detachRecognizerListeners();
    releaseAudioCapture();
    releaseWebSpeech();
    if (recognizer) {
      try {
        recognizer.destroy();
      } catch {
        // ignore
      }
      recognizer = null;
    }
  };

  return {
    start,
    stop,
    reset,
    destroy,
    getCaptureMode: () => captureCleanup?.mode ?? null,
    getPhase: () => activePhase,
    isStreamAsrUnavailable: () => streamAsrUnavailable,
  };
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

  const controllerRef = useRef<StreamAsrController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = createStreamAsrController({
      setStatus,
      setBackend,
      setDownloadPercent,
      setVadState,
      setAudioLevel,
      setInterimText,
      setFinalText,
      setError,
      setStatusHint,
      getOnFinal: () => onFinalRef.current,
      getOnInterim: () => onInterimRef.current,
    });
  }

  useEffect(() => {
    const hasWebAudio =
      typeof navigator !== "undefined" &&
      typeof navigator.mediaDevices?.getUserMedia === "function" &&
      Boolean(getAudioContextCtor());
    const hasWebSpeech = Boolean(getSpeechRecognitionCtor());
    setIsSupported(hasWebAudio || hasWebSpeech);
  }, []);

  useEffect(() => {
    return () => {
      controllerRef.current?.destroy();
    };
  }, []);

  const start = useCallback(async () => {
    await controllerRef.current?.start();
  }, []);

  const stop = useCallback(() => {
    controllerRef.current?.stop();
  }, []);

  const reset = useCallback(() => {
    controllerRef.current?.reset();
  }, []);

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
