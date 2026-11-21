import { readFileSync } from "node:fs";
import path from "node:path";
import {
  geocodeAddressClient,
  isValidCoordinate,
  runWithConcurrency,
} from "@/lib/map/client-geocode";
import { loadEcharts } from "@/app/_components/civic/civic-charts";
import { buildSafeCsv, sanitizeCsvCell } from "@/lib/export-csv";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`FAIL: ${label}`);
  }
}

function readRepoFile(relPath: string): string {
  return readFileSync(path.resolve(process.cwd(), relPath), "utf8");
}

async function testGeocodeAndConcurrency() {
  // 1. isValidCoordinate handles (0, 0) accurately while rejecting NaN/Infinity/null
  assert(isValidCoordinate(0, 0) === true, "(0, 0) is a valid coordinate pair");
  assert(isValidCoordinate(-113.36, 0) === true, "negative lng with lat=0 is valid");
  assert(isValidCoordinate(NaN, 23.1) === false, "NaN coordinate is rejected");
  assert(isValidCoordinate(113.3, Infinity) === false, "Infinity coordinate is rejected");
  assert(isValidCoordinate(undefined, 23.1) === false, "undefined coordinate is rejected");

  // 2. geocodeAddressClient preserves (0, 0), forwards x-region-id & regionId, and respects AbortSignal
  const origFetch = globalThis.fetch;
  const origWindow = (globalThis as any).window;
  try {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    (globalThis as any).fetch = async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(
        JSON.stringify({
          success: true,
          lng: 0,
          lat: 0,
          formattedAddress: "赤道零点基准",
          township: "测试街道",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    const resZero = await geocodeAddressClient("基准测试路1号", "顺德区", {
      regionId: "fs_shunde",
    });
    assert(
      resZero.success === true && resZero.lng === 0 && resZero.lat === 0,
      "geocodeAddressClient accepts (0, 0) response without falsy rejection"
    );
    assert(calls.length === 1 && calls[0].url === "/api/map/geocode", "fallback posts to /api/map/geocode");
    const sentHeaders = calls[0].init?.headers as Record<string, string>;
    const sentBody = JSON.parse(String(calls[0].init?.body || "{}"));
    assert(sentHeaders?.["x-region-id"] === "fs_shunde", "geocodeAddressClient sends x-region-id header");
    assert(sentBody?.regionId === "fs_shunde", "geocodeAddressClient sends regionId in body");

    // Pre-aborted signal makes zero network calls
    calls.length = 0;
    const preAborted = new AbortController();
    preAborted.abort();
    const resAborted = await geocodeAddressClient("大良清晖园", "顺德区", {
      signal: preAborted.signal,
      regionId: "fs_shunde",
    });
    assert(resAborted.success === false && calls.length === 0, "pre-aborted geocode makes zero fetch calls");

    // In-flight abort when Tianditu key is present does not fall back to /api/map/geocode
    (globalThis as any).window = { __TIANDITU_TK__: "test-tk-123" };
    calls.length = 0;
    const midAbort = new AbortController();
    (globalThis as any).fetch = async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      midAbort.abort();
      throw new DOMException("Aborted", "AbortError");
    };
    const resMidAbort = await geocodeAddressClient("天河体育中心", "天河区", {
      signal: midAbort.signal,
      regionId: "gz_tianhe",
    });
    assert(
      resMidAbort.success === false && calls.length === 1 && calls[0].url.includes("tianditu.gov.cn"),
      "aborted Tianditu request does not fall back to /api/map/geocode"
    );
  } finally {
    globalThis.fetch = origFetch;
    if (origWindow === undefined) {
      delete (globalThis as any).window;
    } else {
      (globalThis as any).window = origWindow;
    }
  }

  // 3. runWithConcurrency bounds active workers and stops on abort
  let active = 0;
  let maxActive = 0;
  const inputs = [10, 20, 30, 40, 50, 60];
  const out = await runWithConcurrency(inputs, 2, async (n) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 10));
    active -= 1;
    return n * 2;
  });
  assert(maxActive <= 2 && maxActive >= 1, `runWithConcurrency bounds concurrency <= 2 (got ${maxActive})`);
  assert(
    JSON.stringify(out) === JSON.stringify([20, 40, 60, 80, 100, 120]),
    "runWithConcurrency preserves output ordering"
  );

  const abortCtrl = new AbortController();
  let executedCount = 0;
  await runWithConcurrency(
    [1, 2, 3, 4, 5],
    1,
    async (n) => {
      executedCount += 1;
      if (n === 2) abortCtrl.abort();
      return n;
    },
    abortCtrl.signal
  );
  assert(executedCount === 2, `runWithConcurrency stops after abort (executed=${executedCount})`);

  const nanOut = await runWithConcurrency([1, 2, 3], NaN, async (x) => x);
  assert(
    JSON.stringify(nanOut) === JSON.stringify([1, 2, 3]),
    `runWithConcurrency handles NaN concurrency by falling back to 1 (got ${JSON.stringify(nanOut)})`
  );
  const zeroOut = await runWithConcurrency([4, 5], 0, async (x) => x * 10);
  assert(
    JSON.stringify(zeroOut) === JSON.stringify([40, 50]),
    `runWithConcurrency handles 0 concurrency by falling back to 1 (got ${JSON.stringify(zeroOut)})`
  );
  const infOut = await runWithConcurrency([7, 8, 9], Infinity, async (x) => x + 1);
  assert(
    JSON.stringify(infOut) === JSON.stringify([8, 9, 10]),
    `runWithConcurrency handles Infinity concurrency cleanly (got ${JSON.stringify(infOut)})`
  );
}

async function testLoadEchartsRecovery() {
  const origWindow = (globalThis as any).window;
  const origDocument = (globalThis as any).document;

  try {
    type FakeScript = {
      src: string;
      async: boolean;
      dataset: Record<string, string>;
      attrs: Record<string, string>;
      listeners: Record<string, Set<() => void>>;
      onload: (() => void) | null;
      onerror: (() => void) | null;
      removed: boolean;
      setAttribute: (k: string, v: string) => void;
      getAttribute: (k: string) => string | null;
      addEventListener: (ev: string, cb: () => void) => void;
      removeEventListener: (ev: string, cb: () => void) => void;
      remove: () => void;
    };

    const scripts: FakeScript[] = [];
    const fakeWindow: Record<string, any> = {};
    const fakeDoc = {
      head: {
        appendChild: (el: FakeScript) => {
          scripts.push(el);
        },
      },
      querySelector: (sel: string) => {
        if (sel === "script[data-civic-echarts]") {
          return scripts.find((s) => !s.removed && s.dataset.civicEcharts === "1") || null;
        }
        return null;
      },
      createElement: (tag: string) => {
        if (tag !== "script") throw new Error(`unexpected tag ${tag}`);
        const s: FakeScript = {
          src: "",
          async: false,
          dataset: {},
          attrs: {},
          listeners: { load: new Set(), error: new Set() },
          onload: null,
          onerror: null,
          removed: false,
          setAttribute(k: string, v: string) {
            this.attrs[k] = v;
            if (k === "data-civic-echarts-state") this.dataset.civicEchartsState = v;
          },
          getAttribute(k: string) {
            if (k === "data-civic-echarts-state") return this.dataset.civicEchartsState || this.attrs[k] || null;
            return this.attrs[k] || null;
          },
          addEventListener(ev: string, cb: () => void) {
            this.listeners[ev]?.add(cb);
          },
          removeEventListener(ev: string, cb: () => void) {
            this.listeners[ev]?.delete(cb);
          },
          remove() {
            this.removed = true;
          },
        };
        return s;
      },
    };

    (globalThis as any).window = fakeWindow;
    (globalThis as any).document = fakeDoc;

    // Attempt 1: script.onerror fires -> rejects, removes script, resets echartsPromise
    const p1 = loadEcharts();
    assert(scripts.length === 1, "loadEcharts creates first script element");
    scripts[0].onerror?.();
    let err1Caught = false;
    try {
      await p1;
    } catch {
      err1Caught = true;
    }
    assert(err1Caught === true, "loadEcharts rejects on script onerror");
    assert(scripts[0].removed === true, "failed script tag is removed from DOM on error");

    // Attempt 2: onload fires WITHOUT window.echarts -> rejects, removes script, resets echartsPromise
    const p2 = loadEcharts();
    assert(scripts.length === 2, "loadEcharts creates fresh script after failure");
    scripts[1].onload?.();
    let err2Caught = false;
    try {
      await p2;
    } catch {
      err2Caught = true;
    }
    assert(err2Caught === true, "loadEcharts rejects when onload fires without window.echarts");
    assert(scripts[1].removed === true, "script tag without window.echarts is removed from DOM");

    // Attempt 3: succeeds when window.echarts is populated
    const p3 = loadEcharts();
    assert(scripts.length === 3, "loadEcharts creates third script on retry");
    const mockEcharts = { init: () => ({}) };
    fakeWindow.echarts = mockEcharts;
    scripts[2].onload?.();
    const resolved = await p3;
    assert((resolved as unknown) === mockEcharts, "loadEcharts resolves to window.echarts after retry");
  } finally {
    if (origWindow === undefined) delete (globalThis as any).window;
    else (globalThis as any).window = origWindow;
    if (origDocument === undefined) delete (globalThis as any).document;
    else (globalThis as any).document = origDocument;
  }
}

function testCsvSafetyAndCallers() {
  const payloads = [
    "=cmd|'/C calc'!A0",
    "+1+1",
    "-2+3",
    "@SUM(1+1)",
    "\t=1",
    "\r=1",
    " =1+1",
    "\u200B=1+1",
  ];
  for (const p of payloads) {
    const cell = sanitizeCsvCell(p);
    assert(cell.startsWith("'"), `sanitizeCsvCell neutralizes payload: ${JSON.stringify(p)}`);
  }

  const csv = buildSafeCsv(
    ["编号", "标题", "备注"],
    [["T-001", '=HYPERLINK("http://evil.com","click")', "正常,含逗号"]],
    { includeBom: true }
  );
  assert(csv.startsWith("\uFEFF"), "buildSafeCsv supports includeBom: true");
  assert(csv.includes("\"'=HYPERLINK("), "buildSafeCsv escapes formula and quotes embedded quotes");
  assert(csv.includes('"正常,含逗号"'), "buildSafeCsv RFC-4180 quotes commas");

  for (const rel of [
    "app/dashboard-client.tsx",
    "app/themes/themes-client.tsx",
    "app/tickets/tickets-client.tsx",
  ]) {
    const src = readRepoFile(rel);
    assert(src.includes("buildSafeCsv") && src.includes("@/lib/export-csv"), `${rel} imports buildSafeCsv from @/lib/export-csv`);
    assert(!src.includes("lines.join("), `${rel} has zero raw lines.join CSV concatenation`);
  }
}

function testStaticM10Invariants() {
  // P1 #8: AbortController, debounce, x-region-id, zero falsy (0,0) checks, M2 preservation
  for (const rel of [
    "app/dashboard-client.tsx",
    "app/themes/themes-client.tsx",
    "app/themes/[id]/theme-detail-client.tsx",
    "app/tickets/tickets-client.tsx",
    "app/tickets/[id]/ticket-detail-client.tsx",
    "app/multifreq/multifreq-client.tsx",
    "app/dict/dict-client.tsx",
    "app/_components/civic/ticket-verdict-view.tsx",
    "app/agent/agent-client.tsx",
  ]) {
    const src = readRepoFile(rel);
    assert(src.includes("AbortController"), `${rel} uses AbortController`);
    assert(src.includes("x-region-id"), `${rel} forwards x-region-id header`);
  }

  const ticketsSrc = readRepoFile("app/tickets/tickets-client.tsx");
  assert(
    ticketsSrc.includes("debouncedKeyword") &&
      ticketsSrc.includes("reviewAbortRef") &&
      ticketsSrc.includes("reviewSeqRef") &&
      ticketsSrc.includes("prevReviewRegionRef") &&
      ticketsSrc.includes("<TablePager"),
    "tickets-client.tsx has debouncedKeyword and preserves M2 review abort/seq/TablePager"
  );

  const ticketDetailSrc = readRepoFile("app/tickets/[id]/ticket-detail-client.tsx");
  assert(
    ticketDetailSrc.includes("regionLoading") &&
      ticketDetailSrc.includes("activeRegion?.id"),
    "ticket-detail-client.tsx waits for regionLoading and tracks activeRegion?.id"
  );

  const dictSrc = readRepoFile("app/dict/dict-client.tsx");
  assert(
    dictSrc.includes("debouncedSearchQuery") &&
      dictSrc.includes("testDebounceRef") &&
      dictSrc.includes('className="z-[2010]"') &&
      !dictSrc.includes("animate-pulse") &&
      !dictSrc.includes("workorder-table-wrap"),
    "dict-client.tsx debounces search/sandbox, fixes SelectContent z-[2010], removes animate-pulse & workorder-table-wrap"
  );

  const verdictSrc = readRepoFile("app/_components/civic/ticket-verdict-view.tsx");
  assert(
    verdictSrc.includes("runWithConcurrency") &&
      verdictSrc.includes("isValidCoordinate") &&
      verdictSrc.includes('dynamic('),
    "ticket-verdict-view.tsx uses bounded parallel geocoding, isValidCoordinate, and dynamic CivicGeoMap"
  );

  // P1 #9: Route lazy loading & map cleanup
  const agentSrc = readRepoFile("app/agent/agent-client.tsx");
  assert(
    agentSrc.includes("dynamic(") &&
      agentSrc.includes("voiceMounted") &&
      agentSrc.includes("AgentReportMarkdown") &&
      agentSrc.includes("reportTabVisited"),
    "agent-client.tsx lazy-loads VoiceOutreachDialog & AgentReportMarkdown with sticky mount flags"
  );

  const themeDetailSrc = readRepoFile("app/themes/[id]/theme-detail-client.tsx");
  assert(
    themeDetailSrc.includes('import dynamic from "next/dynamic"') &&
      themeDetailSrc.includes("GraphVisualizer") &&
      themeDetailSrc.includes("CivicEChart"),
    "theme-detail-client.tsx uses next/dynamic for GraphVisualizer and CivicEChart"
  );

  const dashboardSrc = readRepoFile("app/dashboard-client.tsx");
  assert(
    dashboardSrc.includes('import dynamic from "next/dynamic"') &&
      dashboardSrc.includes("CockpitView") &&
      dashboardSrc.includes("CivicEChart"),
    "dashboard-client.tsx uses next/dynamic for CockpitView and CivicEChart"
  );

  const multifreqSrc = readRepoFile("app/multifreq/multifreq-client.tsx");
  assert(
    multifreqSrc.includes('import dynamic from "next/dynamic"') &&
      multifreqSrc.includes("CivicMap") &&
      !multifreqSrc.includes("modal-mask"),
    "multifreq-client.tsx uses next/dynamic for CivicMap and Radix Dialog instead of modal-mask"
  );

  const geoMapSrc = readRepoFile("app/_components/civic/civic-geo-map.tsx");
  assert(
    geoMapSrc.includes('import "leaflet/dist/leaflet.css"') &&
      geoMapSrc.includes("safeCssColor") &&
      geoMapSrc.includes("textContent") &&
      geoMapSrc.includes("clearTimeout") &&
      geoMapSrc.includes("observer.disconnect()") &&
      geoMapSrc.includes('off("zoom"') &&
      geoMapSrc.includes('off("zoomend"'),
    "civic-geo-map.tsx cleans up timers, ResizeObserver, zoom listeners while preserving M2 CSS/XSS guards"
  );

  // P1 #10: Radix Dialog migrations, table a11y, mobile touch & fab clearance
  const dialogSrc = readRepoFile("app/_components/ui/dialog.tsx");
  assert(
    dialogSrc.includes("overscroll-contain") &&
      dialogSrc.includes("max-h-[90dvh]") &&
      dialogSrc.includes("showCloseButton") &&
      dialogSrc.includes("closeLabel") &&
      dialogSrc.includes("closeDisabled") &&
      !dialogSrc.includes("bg-slate-950"),
    "dialog.tsx uses Civic light tokens, overscroll-contain, 90dvh mobile bounds, and close props"
  );

  const regionsSrc = readRepoFile("app/admin/regions/regions-client.tsx");
  assert(
    regionsSrc.includes("<Dialog") &&
      regionsSrc.includes('closeLabel="关闭向导弹窗"') &&
      regionsSrc.includes("URL.createObjectURL") &&
      regionsSrc.includes("URL.revokeObjectURL") &&
      !regionsSrc.includes("dangerouslySetInnerHTML") &&
      !regionsSrc.includes("fixed inset-0 z-[2000]"),
    "regions-client.tsx migrates both modals to Radix Dialog and preserves M2 SVG Blob URL preview"
  );

  const uploadSrc = readRepoFile("app/_components/dashboard/upload-dialog.tsx");
  assert(
    uploadSrc.includes("<Dialog") &&
      uploadSrc.includes("UploadDialog as DataEntryDialog") &&
      uploadSrc.includes('role="tablist"') &&
      uploadSrc.includes("grid-cols-1 sm:grid-cols-3") &&
      !uploadSrc.includes("fixed inset-0 z-[2000]"),
    "upload-dialog.tsx migrates to Radix Dialog, preserves DataEntryDialog alias, and adapts 390px grid"
  );

  const videoSrc = readRepoFile("app/_components/civic/video-modal.tsx");
  assert(
    videoSrc.includes("<Dialog") &&
      videoSrc.includes('aria-label="关闭视频"') &&
      videoSrc.includes("video-modal-close-btn") &&
      !videoSrc.includes("createPortal") &&
      !videoSrc.includes("document.body.style.overflow"),
    "video-modal.tsx migrates to Radix Dialog, removes createPortal/body overflow mutation, and keeps E2E selectors"
  );

  for (const tableRel of [
    "app/dict/dict-client.tsx",
    "app/tickets/tickets-client.tsx",
    "app/multifreq/multifreq-client.tsx",
    "app/themes/themes-client.tsx",
    "app/_components/civic/civic-charts.tsx",
  ]) {
    const src = readRepoFile(tableRel);
    assert(src.includes('<caption className="sr-only">'), `${tableRel} includes sr-only table caption`);
    assert(src.includes('scope="col"'), `${tableRel} includes th scope="col"`);
  }

  const tokensSrc = readRepoFile("app/_components/civic/tokens.css");
  assert(
    tokensSrc.includes("scroll-padding-bottom") &&
      tokensSrc.includes("body:has(.chat-fab) .main") &&
      tokensSrc.includes("@media (max-width: 640px), (pointer: coarse)") &&
      tokensSrc.includes("min-block-size: 44px") &&
      tokensSrc.includes(".quadrant-footer") &&
      tokensSrc.includes(".video-info-card"),
    "tokens.css enforces 44px mobile/touch targets, chat-fab clearance, and 390px wrap/height fixes"
  );

  // Iteration 2 regressions:
  // 1. theme-detail-client.tsx Effect 2 tracks memberRowsRef and omits memberRows from abort-cleanup deps
  const targetEffectMatch = themeDetailSrc.match(
    /useEffect\(\(\)\s*=>\s*\{[\s\S]*?\/api\/workorders\/\$\{encodeURIComponent\(targetTicketId\)\}[\s\S]*?\},\s*\[([^\]]*)\]\)/
  );
  assert(
    Boolean(targetEffectMatch) &&
      !targetEffectMatch![1].includes("memberRows") &&
      themeDetailSrc.includes("memberRowsRef.current"),
    "theme-detail-client.tsx Effect 2 uses memberRowsRef and omits memberRows from dependency array"
  );
  const targetFetchBlock = targetEffectMatch?.[0] || "";
  const fetchCallIdx = targetFetchBlock.indexOf("fetch(`/api/workorders/");
  const nonExistsMarkIdx = targetFetchBlock.indexOf("extraTargetFetchedRef.current = fetchKey", fetchCallIdx);
  assert(
    fetchCallIdx > 0 && nonExistsMarkIdx > fetchCallIdx,
    "theme-detail-client.tsx Effect 2 marks extraTargetFetchedRef only after fetch resolves non-aborted"
  );

  // 2. dict-client.tsx clears testDebounceRef in runTestReplace and region switch effect
  const runTestReplaceMatch = dictSrc.match(
    /const runTestReplace = useCallback\([\s\S]*?\n\s*\},\s*\[isAdmin, regionHeaders\]\s*\);/
  );
  assert(
    Boolean(runTestReplaceMatch) && runTestReplaceMatch![0].includes("clearTimeout(testDebounceRef.current)"),
    "dict-client.tsx runTestReplace clears pending testDebounceRef timer"
  );
  const regionSampleEffectMatch = dictSrc.match(
    /useEffect\(\(\)\s*=>\s*\{[\s\S]*?runTestReplace\(sample\)[\s\S]*?\},\s*\[activeRegion\?\.id, isRolePending, isAdmin, runTestReplace\]\s*\);/
  );
  assert(
    Boolean(regionSampleEffectMatch) &&
      regionSampleEffectMatch![0].includes("clearTimeout(testDebounceRef.current)") &&
      regionSampleEffectMatch![0].includes("return () =>"),
    "dict-client.tsx region switch effect clears testDebounceRef in body and cleanup"
  );

  // 3. agent-client.tsx mobile >=44px touch targets on tabs & 清除筛选 chip button
  const queueTabMatch = agentSrc.match(/id="tab-agent-queue"[\s\S]*?\n\s*>/);
  const reportTabMatch = agentSrc.match(/id="tab-agent-report"[\s\S]*?\n\s*>/);
  const clearFilterMatch = agentSrc.match(/onClick=\{\(\)\s*=>\s*setAutonomyFilter\("ALL"\)\}[\s\S]*?\n\s*>/);
  assert(
    Boolean(queueTabMatch?.[0].includes("min-h-[44px] sm:min-h-[42px]")),
    "agent-client.tsx #tab-agent-queue uses min-h-[44px] sm:min-h-[42px]"
  );
  assert(
    Boolean(reportTabMatch?.[0].includes("min-h-[44px] sm:min-h-[42px]")),
    "agent-client.tsx #tab-agent-report uses min-h-[44px] sm:min-h-[42px]"
  );
  assert(
    Boolean(clearFilterMatch?.[0].includes("min-h-[44px] sm:min-h-[24px]")),
    "agent-client.tsx 清除筛选 button uses min-h-[44px] sm:min-h-[24px]"
  );

  // 4. DialogHeader pr-10 close-button clearance in dict-client.tsx & regions-client.tsx
  const dictHeaderMatches = dictSrc.match(/<DialogHeader className="text-left space-y-1 pr-10">/g) || [];
  assert(
    dictHeaderMatches.length === 2,
    `dict-client.tsx both DialogHeaders include pr-10 clearance (got ${dictHeaderMatches.length})`
  );
  assert(
    regionsSrc.includes('<DialogHeader className="text-left space-y-1 pr-10">'),
    "regions-client.tsx uploadModalRegion DialogHeader includes pr-10 clearance"
  );
}

async function main() {
  await testGeocodeAndConcurrency();
  await testLoadEchartsRecovery();
  testCsvSafetyAndCallers();
  testStaticM10Invariants();

  console.log(`M10 P1 Frontend/A11y/Race Tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void main();
