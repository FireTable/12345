/**
 * M2_P0_Frontend_Bundle_ASR 单元测试（P0 #3, P0 #11, P0 #12 & Review Tab TablePager）
 *
 * 运行命令：pnpm exec tsx tests/test-p0-m2-frontend-asr.ts
 * 零数据库依赖、零网络依赖，不触碰 tests/test-mcp.ts。
 */

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {
  createStreamAsrController,
  joinTranscriptParts,
  setupAudioCaptureGraph,
  type AsrBackendMode,
  type AsrStatus,
  type AudioContextLike,
  type AudioWorkletNodeLike,
  type ScriptProcessorNodeLike,
  type SpeechRecognitionInstance,
  type StreamRecognizerLike,
} from "../app/_hooks/use-stream-asr";
import { isSafeRedirectFrom, resolveAdminPageRedirect } from "../lib/auth/page-guard";

let passed = 0;
let failed = 0;

function assert(cond: unknown, msg: string) {
  if (!cond) {
    failed += 1;
    console.error(`FAIL: ${msg}`);
    process.exitCode = 1;
  } else {
    passed += 1;
    console.log(`PASS: ${msg}`);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class MockMediaStream {
  public stopped = false;
  getTracks() {
    return [
      {
        stop: () => {
          this.stopped = true;
        },
      },
    ] as unknown as MediaStreamTrack[];
  }
}

class MockStreamRecognizer implements StreamRecognizerLike {
  public listeners = new Map<string, Set<(payload: unknown) => void>>();
  public isReady = false;
  public initCalls = 0;
  public finishCalls = 0;
  public resetCalls = 0;
  public destroyCalls = 0;
  public fedChunks: Array<{ samples: Float32Array; sampleRate: number }> = [];
  public failNextInit = false;

  on(event: string, listener: (ev: never) => void) {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as unknown as (payload: unknown) => void);
  }

  off(event: string, listener: (ev: never) => void) {
    this.listeners.get(event)?.delete(listener as unknown as (payload: unknown) => void);
  }

  emit(event: string, payload: unknown) {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const fn of [...set]) {
      fn(payload);
    }
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  totalListenerCount(): number {
    let total = 0;
    for (const set of this.listeners.values()) total += set.size;
    return total;
  }

  async init(): Promise<void> {
    this.initCalls += 1;
    if (this.failNextInit) {
      this.failNextInit = false;
      throw new Error("Mock model init error");
    }
    this.isReady = true;
  }

  feed(inputPcm: Float32Array, inputSampleRate = 16000) {
    this.fedChunks.push({ samples: inputPcm, sampleRate: inputSampleRate });
  }

  finish() {
    this.finishCalls += 1;
  }

  reset() {
    this.resetCalls += 1;
  }

  destroy() {
    this.destroyCalls += 1;
    this.listeners.clear();
    this.isReady = false;
  }
}

function createMockAudioHarness(opts?: {
  hasAudioWorklet?: boolean;
  rejectAddModule?: boolean;
}) {
  const hasAudioWorklet = opts?.hasAudioWorklet !== false;
  const rejectAddModule = opts?.rejectAddModule === true;
  const postedMessages: unknown[] = [];
  const addedModules: string[] = [];
  let workletNode: AudioWorkletNodeLike | null = null;
  let scriptProcessorNode: ScriptProcessorNodeLike | null = null;
  let disconnectedCount = 0;
  let closed = false;

  const audioCtx: AudioContextLike = {
    sampleRate: 16000,
    get state() {
      return closed ? "closed" : "running";
    },
    destination: {},
    audioWorklet: hasAudioWorklet
      ? {
          addModule: async (url: string) => {
            addedModules.push(url);
            if (rejectAddModule) throw new Error("addModule blocked");
          },
        }
      : undefined,
    resume: async () => {},
    close: async () => {
      closed = true;
    },
    createMediaStreamSource: () => ({
      connect: () => {},
      disconnect: () => {
        disconnectedCount += 1;
      },
    }),
    createGain: () => ({
      gain: { value: 1 },
      connect: () => {},
      disconnect: () => {
        disconnectedCount += 1;
      },
    }),
    createScriptProcessor: () => {
      scriptProcessorNode = {
        onaudioprocess: null,
        connect: () => {},
        disconnect: () => {
          disconnectedCount += 1;
        },
      };
      return scriptProcessorNode;
    },
  };

  const createWorkletNode = (): AudioWorkletNodeLike => {
    workletNode = {
      port: {
        onmessage: null,
        postMessage: (msg: unknown) => {
          postedMessages.push(msg);
        },
      },
      connect: () => {},
      disconnect: () => {
        disconnectedCount += 1;
      },
    };
    return workletNode;
  };

  return {
    audioCtx,
    createWorkletNode,
    addedModules,
    postedMessages,
    getWorkletNode: () => workletNode,
    getScriptProcessorNode: () => scriptProcessorNode,
    getDisconnectedCount: () => disconnectedCount,
    isClosed: () => closed,
  };
}

function createHarness(overrides?: {
  recognizer?: MockStreamRecognizer;
  hasAudioWorklet?: boolean;
  rejectAddModule?: boolean;
  finalizeTimeoutMs?: number;
  withWebSpeech?: boolean;
  hasPcmCaptureSupport?: () => boolean;
}) {
  const recognizer = overrides?.recognizer ?? new MockStreamRecognizer();
  const audioHarness = createMockAudioHarness({
    hasAudioWorklet: overrides?.hasAudioWorklet,
    rejectAddModule: overrides?.rejectAddModule,
  });

  let status: AsrStatus = "idle";
  let backend: AsrBackendMode = "idle";
  let downloadPercent = 0;
  let vadState = "SILENCE";
  let audioLevel = 0;
  let interimText = "";
  let finalText = "";
  let error: string | null = null;
  let statusHint = "点击麦克风开始语音输入";
  const finalEvents: string[] = [];
  const interimEvents: string[] = [];
  let webSpeechInstance: SpeechRecognitionInstance | null = null;

  class MockSpeechRec implements SpeechRecognitionInstance {
    lang = "zh-CN";
    interimResults = true;
    continuous = true;
    maxAlternatives = 1;
    onstart: (() => void) | null = null;
    onresult: SpeechRecognitionInstance["onresult"] = null;
    onerror: SpeechRecognitionInstance["onerror"] = null;
    onend: (() => void) | null = null;
    start() {
      this.onstart?.();
    }
    stop() {
      this.onend?.();
    }
    abort() {
      this.onend?.();
    }
  }

  const controller = createStreamAsrController({
    setStatus: (next) => {
      status = typeof next === "function" ? next(status) : next;
    },
    setBackend: (next) => {
      backend = next;
    },
    setDownloadPercent: (next) => {
      downloadPercent = next;
    },
    setVadState: (next) => {
      vadState = next;
    },
    setAudioLevel: (next) => {
      audioLevel = next;
    },
    setInterimText: (next) => {
      interimText = next;
    },
    setFinalText: (next) => {
      finalText = typeof next === "function" ? next(finalText) : next;
    },
    setError: (next) => {
      error = next;
    },
    setStatusHint: (next) => {
      statusHint = typeof next === "function" ? next(statusHint) : next;
    },
    getOnFinal: () => (text) => finalEvents.push(text),
    getOnInterim: () => (text) => interimEvents.push(text),
    requestMicrophone: async () => new MockMediaStream() as unknown as MediaStream,
    createAudioContext: () => audioHarness.audioCtx,
    hasPcmCaptureSupport: overrides?.hasPcmCaptureSupport,
    createWorkletNode: audioHarness.createWorkletNode,
    loadStreamRecognizerCtor: async () =>
      function FakeCtor() {
        return recognizer;
      } as unknown as new () => StreamRecognizerLike,
    getSpeechRecognitionCtor: () =>
      overrides?.withWebSpeech === false
        ? null
        : (function () {
            webSpeechInstance = new MockSpeechRec();
            return webSpeechInstance;
          } as unknown as new () => SpeechRecognitionInstance),
    finalizeTimeoutMs: overrides?.finalizeTimeoutMs ?? 40,
    initTimeoutMs: 5000,
    now: () => 1000,
  });

  return {
    controller,
    recognizer,
    audioHarness,
    state: () => ({
      status,
      backend,
      downloadPercent,
      vadState,
      audioLevel,
      interimText,
      finalText,
      error,
      statusHint,
      finalEvents,
      interimEvents,
      webSpeechInstance,
    }),
  };
}

async function runTests() {
  // 0. joinTranscriptParts sanity
  assert(
    joinTranscriptParts("第一句", "第二句") === "第一句，第二句",
    "joinTranscriptParts inserts Chinese comma between non-punctuated segments"
  );
  assert(
    joinTranscriptParts("第一句。", "第二句") === "第一句。第二句",
    "joinTranscriptParts preserves trailing punctuation"
  );

  // 1. Listener Lifecycle & Leak Prevention (3 start/stop cycles)
  {
    const h = createHarness({ finalizeTimeoutMs: 30 });
    for (let cycle = 1; cycle <= 3; cycle++) {
      await h.controller.start();
      assert(
        h.recognizer.listenerCount("recognized") === 1 &&
          h.recognizer.listenerCount("recognizing") === 1 &&
          h.recognizer.listenerCount("download_progress") === 1,
        `Cycle ${cycle}: exactly 1 listener per event while active`
      );
      h.recognizer.emit("recognizing", { text: `第${cycle}轮` });
      h.controller.stop();
      await sleep(50);
      assert(
        h.recognizer.totalListenerCount() === 0,
        `Cycle ${cycle}: 0 listeners remaining after finalization`
      );
    }
    assert(
      h.state().finalEvents.length === 3,
      `3 cycles yielded 3 final commitments (got ${h.state().finalEvents.length})`
    );
    h.controller.destroy();
  }

  // 2. handleRecognized sessionId guard
  {
    const h = createHarness({ finalizeTimeoutMs: 40 });
    await h.controller.start();
    const capturedSession1Listeners = [...(h.recognizer.listeners.get("recognized") ?? [])];
    assert(capturedSession1Listeners.length === 1, "Captured session 1 recognized listener");
    h.controller.reset();
    await h.controller.start();
    capturedSession1Listeners[0]({ text: "过期旧会话文本" });
    assert(
      h.state().finalText === "" && h.state().finalEvents.length === 0,
      "Stale session 1 recognized listener ignored during session 2"
    );
    h.controller.destroy();
  }

  // 3. stop() Tail-Word Fallback & Race Cases
  // Case A: no recognized event from worker -> finalizeTimer commits tail words
  {
    const h = createHarness({ finalizeTimeoutMs: 35 });
    await h.controller.start();
    h.recognizer.emit("recognizing", { text: "投诉噪音尾字" });
    h.controller.stop();
    assert(h.recognizer.finishCalls === 1, "Case A: recognizer.finish() called once");
    assert(h.state().finalEvents.length === 0, "Case A: not committed prematurely before worker/timer");
    await sleep(60);
    assert(
      h.state().finalEvents.length === 1 && h.state().finalEvents[0] === "投诉噪音尾字",
      "Case A: finalizeTimer committed tail words once"
    );
    assert(h.recognizer.totalListenerCount() === 0, "Case A: listeners detached after timer");
    h.controller.destroy();
  }

  // Case B: recognized arrives before timer -> timer cancelled, zero duplicate commit
  {
    const h = createHarness({ finalizeTimeoutMs: 50 });
    await h.controller.start();
    h.recognizer.emit("recognizing", { text: "正在说" });
    h.controller.stop();
    await sleep(10);
    h.recognizer.emit("recognized", { text: "正在说完整" });
    await sleep(70);
    assert(
      h.state().finalEvents.length === 1 && h.state().finalEvents[0] === "正在说完整",
      "Case B: recognized before timer commits once and cancels timer"
    );
    assert(h.recognizer.totalListenerCount() === 0, "Case B: listeners detached immediately");
    h.controller.destroy();
  }

  // Case C: empty recognized("") -> falls back to pending interim once
  {
    const h = createHarness({ finalizeTimeoutMs: 40 });
    await h.controller.start();
    h.recognizer.emit("recognizing", { text: "最后两个字" });
    h.controller.stop();
    h.recognizer.emit("recognized", { text: "" });
    await sleep(60);
    assert(
      h.state().finalEvents.length === 1 && h.state().finalEvents[0] === "最后两个字",
      "Case C: empty recognized falls back to pending interim once"
    );
    h.controller.destroy();
  }

  // Case D: Multi-utterance session -> utterance 1 commit does NOT block utterance 2 tail words
  {
    const h = createHarness({ finalizeTimeoutMs: 35 });
    await h.controller.start();
    h.recognizer.emit("recognizing", { text: "第一句" });
    h.recognizer.emit("recognized", { text: "第一句" });
    h.recognizer.emit("recognizing", { text: "第二句尾字" });
    h.controller.stop();
    await sleep(60);
    assert(
      h.state().finalEvents.length === 2 &&
        h.state().finalEvents[0] === "第一句" &&
        h.state().finalEvents[1] === "第二句尾字" &&
        h.state().finalText === "第一句，第二句尾字",
      `Case D: multi-utterance commits both segments (got "${h.state().finalText}")`
    );
    h.controller.destroy();
  }

  // Case E: idle stop() does not clobber statusHint; double stop() calls finish() once
  {
    const h = createHarness({ finalizeTimeoutMs: 40 });
    h.controller.stop();
    assert(
      h.state().statusHint === "点击麦克风开始语音输入",
      "Case E: idle stop() does not overwrite statusHint"
    );
    await h.controller.start();
    h.controller.stop();
    h.controller.stop();
    assert(h.recognizer.finishCalls === 1, "Case E: double stop() calls finish() only once");
    await sleep(60);
    h.controller.destroy();
  }

  // 4. reset() clears streamAsrUnavailableRef and recovers to Stream-ASR
  {
    const rec = new MockStreamRecognizer();
    rec.failNextInit = true;
    const h = createHarness({ recognizer: rec, withWebSpeech: true });
    await h.controller.start();
    assert(
      h.controller.isStreamAsrUnavailable() === true && h.state().backend === "web-speech",
      "Init failure falls back to web-speech and marks streamAsrUnavailable"
    );
    h.controller.reset();
    assert(
      h.controller.isStreamAsrUnavailable() === false &&
        h.state().backend === "idle" &&
        h.state().downloadPercent === 0,
      "reset() clears streamAsrUnavailable, backend, and downloadPercent"
    );
    await h.controller.start();
    assert(
      h.state().backend === "stream-asr" && h.state().status === "recording",
      "After reset(), next start() recovers Stream-ASR"
    );
    h.controller.destroy();
  }

  // 5. AudioWorkletNode path + ScriptProcessorNode silent fallback + asr-worklet.js processor test
  {
    const origConsoleError = console.error;
    const capturedConsoleErrors: unknown[][] = [];
    console.error = (...args: unknown[]) => {
      capturedConsoleErrors.push(args);
    };

    try {
      // 5a: AudioWorklet path
      const h = createHarness({ hasAudioWorklet: true });
      await h.controller.start();
      assert(
        h.controller.getCaptureMode() === "worklet" &&
          h.audioHarness.addedModules[0] === "/civic/asr-worklet.js",
        "AudioWorklet path loads /civic/asr-worklet.js and sets capture mode to worklet"
      );
      const wNode = h.audioHarness.getWorkletNode();
      assert(Boolean(wNode?.port.onmessage), "AudioWorkletNode port.onmessage attached");
      const sampleFrame = new Float32Array(1024).fill(0.1);
      wNode?.port.onmessage?.({ data: sampleFrame } as MessageEvent);
      assert(
        h.recognizer.fedChunks.length === 1 &&
          h.recognizer.fedChunks[0].samples.length === 1024 &&
          h.state().audioLevel > 0,
        "AudioWorkletNode forwards PCM chunk to recognizer.feed and computes audioLevel"
      );
      h.controller.stop();
      assert(
        h.audioHarness.postedMessages.includes("stop") && wNode?.port.onmessage === null,
        "stop() sends 'stop' to worklet port and clears onmessage"
      );
      await sleep(60);
      h.controller.destroy();

      // 5b: Missing audioWorklet -> silent ScriptProcessor fallback
      const hNoWorklet = createHarness({ hasAudioWorklet: false });
      await hNoWorklet.controller.start();
      assert(
        hNoWorklet.controller.getCaptureMode() === "script-processor" &&
          Boolean(hNoWorklet.audioHarness.getScriptProcessorNode()?.onaudioprocess),
        "Missing audioWorklet falls back silently to ScriptProcessorNode"
      );
      hNoWorklet.controller.destroy();

      // 5c: Rejected addModule -> silent ScriptProcessor fallback
      const ctxReject = createMockAudioHarness({ hasAudioWorklet: true, rejectAddModule: true });
      const spCleanup = await setupAudioCaptureGraph({
        audioCtx: ctxReject.audioCtx,
        mediaStream: new MockMediaStream() as unknown as MediaStream,
        createWorkletNode: ctxReject.createWorkletNode,
        isSessionActive: () => true,
        onSamples: () => {},
      });
      assert(
        spCleanup?.mode === "script-processor",
        "Rejected addModule falls back silently to ScriptProcessorNode"
      );
      spCleanup?.cleanup();

      assert(
        capturedConsoleErrors.length === 0,
        `Zero console.error during AudioWorklet/ScriptProcessor fallback (got ${capturedConsoleErrors.length})`
      );
    } finally {
      console.error = origConsoleError;
    }

    // 5d: Evaluate public/civic/asr-worklet.js processor in VM
    const workletPath = path.resolve(process.cwd(), "public/civic/asr-worklet.js");
    assert(existsSync(workletPath), "public/civic/asr-worklet.js exists");
    const workletCode = readFileSync(workletPath, "utf8");
    const postedChunks: Array<{ data: Float32Array; transfer: unknown[] }> = [];
    let registeredName = "";
    let ProcessorClass: (new (opts?: unknown) => {
      port: { onmessage: ((ev: { data: unknown }) => void) | null };
      process: (inputs: Float32Array[][]) => boolean;
    }) | null = null;

    class StubAudioWorkletProcessor {
      port = {
        onmessage: null as ((ev: { data: unknown }) => void) | null,
        postMessage: (data: Float32Array, transfer: unknown[] = []) => {
          postedChunks.push({ data, transfer });
        },
      };
    }

    vm.runInNewContext(workletCode, {
      AudioWorkletProcessor: StubAudioWorkletProcessor,
      Float32Array,
      Math,
      registerProcessor: (name: string, ctor: typeof ProcessorClass) => {
        registeredName = name;
        ProcessorClass = ctor;
      },
    });

    assert(registeredName === "civic-asr-processor" && Boolean(ProcessorClass), "asr-worklet registers civic-asr-processor");
    const proc = new ProcessorClass!({ processorOptions: { chunkSize: 1024 } });
    // 8 frames * 128 = 1024 -> 1 chunk posted; + 2 frames = 256 tail samples
    for (let i = 0; i < 10; i++) {
      const frame = new Float32Array(128).fill(i + 1);
      const keepGoing = proc.process([[frame]]);
      assert(keepGoing === true, `Worklet frame ${i} returns true while active`);
    }
    assert(
      postedChunks.length === 1 && postedChunks[0].data.length === 1024,
      `Worklet emits 1024-sample chunk at boundary (emitted ${postedChunks.length})`
    );
    proc.port.onmessage?.({ data: "stop" });
    assert(
      postedChunks.length === 2 && postedChunks[1].data.length === 256,
      "Worklet 'stop' message flushes 256 remaining tail samples"
    );
    assert(proc.process([[new Float32Array(128)]]) === false, "Worklet process() returns false after 'stop'");
  }

  // 6. page-guard, XSS helpers & M2 static invariants
  {
    const unsafeRedirects = [
      "/\t/evil.com",
      "/\n/evil.com",
      "/\r/evil.com",
      "/\x00/evil.com",
      "/\x1f/evil.com",
      "/\x7f/evil.com",
      "/\\evil.com",
      "/foo\\evil.com",
      "//evil.com",
      "///evil.com",
      "/..//evil.com",
      "https://evil.com/phish",
      "javascript:alert(1)",
      "/",
      "/?tab=a",
      "",
    ];
    for (const candidate of unsafeRedirects) {
      assert(
        isSafeRedirectFrom(candidate) === false &&
          resolveAdminPageRedirect(null, candidate) === "/login",
        `page-guard rejects unsafe redirectFrom: ${JSON.stringify(candidate)}`
      );
    }
    assert(
      isSafeRedirectFrom(undefined) === false &&
        isSafeRedirectFrom(123 as unknown as string) === false &&
        resolveAdminPageRedirect(null, undefined) === "/login",
      "page-guard rejects undefined and non-string redirectFrom"
    );
    assert(
      isSafeRedirectFrom("/themes/123?tab=a") === true &&
        resolveAdminPageRedirect(null, "/themes/123?tab=a") ===
          "/login?from=%2Fthemes%2F123%3Ftab%3Da" &&
        isSafeRedirectFrom("/tickets?tab=review") === true &&
        resolveAdminPageRedirect(null, "/tickets?tab=review") ===
          "/login?from=%2Ftickets%3Ftab%3Dreview",
      "page-guard preserves valid deep-link redirectFrom values"
    );

    assert(
      resolveAdminPageRedirect(null, "/") === "/login" &&
        resolveAdminPageRedirect(null, "/themes/42") === "/login?from=%2Fthemes%2F42" &&
        resolveAdminPageRedirect(null, "/tickets?tab=review") ===
          "/login?from=%2Ftickets%3Ftab%3Dreview" &&
        resolveAdminPageRedirect(null, "//evil.com") === "/login" &&
        resolveAdminPageRedirect(null, "/\\evil.com") === "/login" &&
        resolveAdminPageRedirect(null, "https://evil.com/phish") === "/login" &&
        resolveAdminPageRedirect(null, "javascript:alert(1)") === "/login" &&
        resolveAdminPageRedirect(
          {
            user: { id: "u1", email: "c@x", name: "Citizen", role: "user" },
            session: { id: "s1", userId: "u1" },
          },
          "/tickets"
        ) === "/submit" &&
        resolveAdminPageRedirect(
          {
            user: { id: "a1", email: "a@x", name: "Admin", role: "admin" },
            session: { id: "s2", userId: "a1" },
          },
          "/tickets"
        ) === null,
      "resolveAdminPageRedirect enforces /login, rejects unsafe redirectFrom, /submit for citizen, null for admin"
    );

    const adminPages = [
      "app/page.tsx",
      "app/themes/page.tsx",
      "app/themes/[id]/page.tsx",
      "app/tickets/page.tsx",
      "app/tickets/[id]/page.tsx",
      "app/multifreq/page.tsx",
      "app/dict/page.tsx",
      "app/sandbox/page.tsx",
      "app/screen/page.tsx",
      "app/admin/regions/page.tsx",
      "app/agent/page.tsx",
    ];
    for (const rel of adminPages) {
      const content = readFileSync(path.resolve(process.cwd(), rel), "utf8");
      assert(
        content.includes("requireAdminPage") && !content.includes('"use client"'),
        `Server page guard present and not 'use client': ${rel}`
      );
    }

    const regionsClient = readFileSync(
      path.resolve(process.cwd(), "app/admin/regions/regions-client.tsx"),
      "utf8"
    );
    assert(
      !regionsClient.includes("dangerouslySetInnerHTML") &&
        regionsClient.includes("URL.createObjectURL") &&
        regionsClient.includes("URL.revokeObjectURL"),
      "regions-client.tsx uses Blob URL + revokeObjectURL with zero dangerouslySetInnerHTML"
    );

    for (const mapRel of [
      "app/_components/civic/civic-geo-map.tsx",
      "app/_components/civic/civic-map.tsx",
      "app/_components/cockpit/cockpit-map.tsx",
    ]) {
      const content = readFileSync(path.resolve(process.cwd(), mapRel), "utf8");
      assert(
        content.includes('import "leaflet/dist/leaflet.css"') &&
          content.includes("textContent") &&
          content.includes("safeCssColor") &&
          !content.includes("tooltipHtml") &&
          !content.includes("popupHtml") &&
          !content.includes("centerBadgeHtml") &&
          !content.includes("badgeHtml"),
        `${mapRel} imports leaflet.css dynamically, uses textContent DOM construction & safeCssColor, and removes HTML template strings`
      );
    }

    const layoutContent = readFileSync(path.resolve(process.cwd(), "app/layout.tsx"), "utf8");
    assert(
      !layoutContent.includes("leaflet/dist/leaflet.css") &&
        !layoutContent.includes("workbench.css") &&
        !layoutContent.includes("PipelineDrawer"),
      "app/layout.tsx does not statically import leaflet.css, workbench.css, or PipelineDrawer"
    );

    const ticketsClient = readFileSync(
      path.resolve(process.cwd(), "app/tickets/tickets-client.tsx"),
      "utf8"
    );
    assert(
      ticketsClient.includes("reviewPage") &&
        ticketsClient.includes("reviewSize") &&
        ticketsClient.includes("/api/review?") &&
        ticketsClient.includes("<TablePager") &&
        ticketsClient.includes("reviewSeqRef") &&
        ticketsClient.includes("reviewAbortRef") &&
        ticketsClient.includes("prevReviewRegionRef") &&
        ticketsClient.includes("AbortController"),
      "app/tickets/tickets-client.tsx implements paginated review tab with <TablePager> and seq/abort/region-reset guards"
    );
  }

  // 7. Concurrency & Race Regression Tests (Challenger 2 Probes 1, 2b, 2c, 2d, 2e)
  {
    const createDeferred = <T = void>() => {
      let resolve!: (val: T | PromiseLike<T>) => void;
      let reject!: (err: unknown) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    };

    const createMultiSessionEnv = () => {
      const streams: MockMediaStream[] = [];
      const ctxHarnesses: ReturnType<typeof createMockAudioHarness>[] = [];
      const recs: MockStreamRecognizer[] = [];
      let status: AsrStatus = "idle";
      let finalText = "";
      let maxDownloadListeners = 0;

      const wrapRec = (rec: MockStreamRecognizer) => {
        const origOn = rec.on.bind(rec);
        rec.on = (event: string, listener: (ev: never) => void) => {
          origOn(event, listener);
          if (event === "download_progress") {
            maxDownloadListeners = Math.max(maxDownloadListeners, rec.listenerCount("download_progress"));
          }
        };
        return rec;
      };

      return {
        streams,
        ctxHarnesses,
        recs,
        wrapRec,
        getStatus: () => status,
        getFinalText: () => finalText,
        getMaxDownloadListeners: () => maxDownloadListeners,
        makeController: (opts: {
          initImpls: Array<(rec: MockStreamRecognizer) => Promise<void>>;
          addModuleImpls?: Array<() => Promise<void>>;
          reuseSingleRecognizer?: boolean;
        }) => {
          let streamIdx = 0;
          let ctxIdx = 0;
          let recIdx = 0;
          const sharedRec = opts.reuseSingleRecognizer ? wrapRec(new MockStreamRecognizer()) : null;

          return createStreamAsrController({
            setStatus: (next) => {
              status = typeof next === "function" ? next(status) : next;
            },
            setBackend: () => {},
            setDownloadPercent: () => {},
            setVadState: () => {},
            setAudioLevel: () => {},
            setInterimText: () => {},
            setFinalText: (next) => {
              finalText = typeof next === "function" ? next(finalText) : next;
            },
            setError: () => {},
            setStatusHint: () => {},
            requestMicrophone: async () => {
              const s = new MockMediaStream();
              streams[streamIdx++] = s;
              return s as unknown as MediaStream;
            },
            createAudioContext: () => {
              const idx = ctxIdx++;
              const h = createMockAudioHarness({ hasAudioWorklet: true });
              if (opts.addModuleImpls?.[idx] && h.audioCtx.audioWorklet) {
                const customAddModule = opts.addModuleImpls[idx];
                h.audioCtx.audioWorklet.addModule = async (url: string) => {
                  h.addedModules.push(url);
                  await customAddModule();
                };
              }
              ctxHarnesses[idx] = h;
              return h.audioCtx;
            },
            createWorkletNode: (ctx) => {
              const match = ctxHarnesses.find((h) => h.audioCtx === ctx);
              return match!.createWorkletNode();
            },
            loadStreamRecognizerCtor: async () =>
              function FakeCtor() {
                const idx = recIdx++;
                const r = sharedRec ?? wrapRec(new MockStreamRecognizer());
                recs[idx] = r;
                if (opts.initImpls[idx]) {
                  const impl = opts.initImpls[idx];
                  r.init = async () => {
                    r.initCalls += 1;
                    await impl(r);
                  };
                }
                return r;
              } as unknown as new () => StreamRecognizerLike,
            finalizeTimeoutMs: 30,
            initTimeoutMs: 5000,
          });
        },
      };
    };

    // 7a: download_progress <= 1 during init, 0 after stop() mid-init, and late reject does not clobber Session 2
    {
      const env = createMultiSessionEnv();
      const init1 = createDeferred<void>();
      const init1Entered = createDeferred<void>();
      const ctrl = env.makeController({
        initImpls: [
          async () => {
            init1Entered.resolve();
            await init1.promise;
          },
          async (r) => {
            r.isReady = true;
          },
        ],
      });

      const start1Promise = ctrl.start();
      await init1Entered.promise;
      assert(
        env.getMaxDownloadListeners() === 1 && env.recs[0].listenerCount("download_progress") === 1,
        "7a: download_progress listener count is strictly 1 during init()"
      );

      ctrl.stop();
      assert(
        env.recs[0].totalListenerCount() === 0 &&
          env.streams[0].stopped === true &&
          env.ctxHarnesses[0].isClosed() === true,
        "7a: stop() mid-init() detaches all listeners and releases Session 1 stream & AudioContext immediately"
      );

      await ctrl.start();
      assert(
        env.getStatus() === "recording" &&
          env.streams[1].stopped === false &&
          env.ctxHarnesses[1].isClosed() === false &&
          env.recs[1].totalListenerCount() === 5 &&
          env.recs[1].destroyCalls === 0,
        "7a: immediate start() #2 enters recording with intact resources"
      );

      init1.reject(new Error("late init1 failure"));
      await start1Promise;
      await sleep(20);

      assert(
        env.getStatus() === "recording" &&
          env.streams[1].stopped === false &&
          env.ctxHarnesses[1].isClosed() === false &&
          env.recs[1].totalListenerCount() === 5 &&
          env.recs[1].destroyCalls === 0 &&
          env.recs[1].isReady === true,
        "7a: Session 1 init() late rejection does NOT clobber Session 2 stream, AudioContext, recognizer, or listeners"
      );
      ctrl.destroy();
    }

    // 7b: stop() mid-init() -> immediate start() #2 -> Session 1 watchdog fires (1000ms)
    {
      const env = createMultiSessionEnv();
      const neverSettledInit1 = createDeferred<void>();
      const init1Entered = createDeferred<void>();
      const ctrl = env.makeController({
        initImpls: [
          async () => {
            init1Entered.resolve();
            await neverSettledInit1.promise;
          },
          async (r) => {
            r.isReady = true;
          },
        ],
      });

      const start1Promise = ctrl.start();
      await init1Entered.promise;
      ctrl.stop();
      await ctrl.start();
      await sleep(1100);
      await start1Promise;

      assert(
        env.getStatus() === "recording" &&
          env.streams[1].stopped === false &&
          env.ctxHarnesses[1].isClosed() === false &&
          env.recs[1].totalListenerCount() === 5 &&
          env.recs[1].destroyCalls === 0,
        "7b: Session 1 watchdog firing after stop() -> start() #2 leaves Session 2 completely intact"
      );
      ctrl.destroy();
    }

    // 7c: stop() mid-init() -> immediate start() #2 -> Session 1 init() late RESOLVES
    {
      const env = createMultiSessionEnv();
      const init1 = createDeferred<void>();
      const init1Entered = createDeferred<void>();
      const ctrl = env.makeController({
        initImpls: [
          async (r) => {
            init1Entered.resolve();
            await init1.promise;
            r.isReady = true;
          },
          async (r) => {
            r.isReady = true;
          },
        ],
      });

      const start1Promise = ctrl.start();
      await init1Entered.promise;
      ctrl.stop();
      await ctrl.start();

      init1.resolve();
      await start1Promise;
      await sleep(20);

      assert(
        env.getStatus() === "recording" &&
          env.streams[1].stopped === false &&
          env.ctxHarnesses[1].isClosed() === false &&
          env.recs[1].totalListenerCount() === 5 &&
          env.recs[1].destroyCalls === 0,
        "7c: Session 1 init() late resolve does NOT clobber Session 2 stream, AudioContext, recognizer, or listeners"
      );
      ctrl.destroy();
    }

    // 7d: stop() mid-addModule() -> immediate start() #2 -> addModule #1 resolves late
    {
      const env = createMultiSessionEnv();
      const addMod1 = createDeferred<void>();
      const addMod1Entered = createDeferred<void>();
      const ctrl = env.makeController({
        reuseSingleRecognizer: true,
        initImpls: [
          async (r) => {
            r.isReady = true;
          },
        ],
        addModuleImpls: [
          async () => {
            addMod1Entered.resolve();
            await addMod1.promise;
          },
          async () => {},
        ],
      });

      const start1Promise = ctrl.start();
      await addMod1Entered.promise;
      ctrl.stop();
      await ctrl.start();

      addMod1.resolve();
      await start1Promise;
      await sleep(20);

      assert(
        env.getStatus() === "recording" &&
          ctrl.getCaptureMode() === "worklet" &&
          env.streams[0].stopped === true &&
          env.ctxHarnesses[0].isClosed() === true &&
          env.streams[1].stopped === false &&
          env.ctxHarnesses[1].isClosed() === false &&
          env.recs[0].totalListenerCount() === 5 &&
          env.recs[0].destroyCalls === 0,
        "7d: Session 1 addModule() late resolve leaves Session 2 stream, AudioContext, worklet, recognizer, and listeners intact"
      );
      ctrl.destroy();
    }
  }

  console.log(`\nSummary: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
