import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Papa from "papaparse";
import {
  MAX_RATE_LIMIT_BUCKETS,
  assertTrustedHostAndOrigin,
  checkAgentRateLimit,
  getAgentRateLimitBucketCountForTesting,
  resetAgentRateLimitBucketsForTesting,
} from "../lib/security/agent-guard";
import {
  buildSafeCsv,
  exportSingleThemeTicketsToCSV,
  exportThemeTicketsToCSV,
  exportThemesToCSV,
  sanitizeCsvCell,
} from "../lib/export-csv";
import {
  isAdminRoutePath,
  isSafeRedirectFrom,
  resolvePostLoginTarget,
} from "../lib/security/login-redirect";
import { GET as agentTasksGet } from "../app/api/agent/tasks/route";
import { GET as intakeOptionsGet } from "../app/api/intake/options/route";
import { withAuthHeaders } from "./_auth-helper";
import type { MultiFrequencyTheme } from "../backend/state";

let passed = 0;
function pass(label: string): void {
  passed += 1;
  console.log(`  PASS: ${label}`);
}

async function withEnv(
  overrides: Record<string, string | undefined>,
  fn: () => Promise<void> | void
): Promise<void> {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(overrides)) {
    prev[k] = process.env[k];
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
  try {
    await fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  }
}

function makeHeaderReq(headersObj: Record<string, string>): Request {
  return new Request("http://localhost:3000/api/agent/tasks", {
    method: "GET",
    headers: new Headers(headersObj),
  });
}

async function testAgentGuardHostAndProxy(): Promise<void> {
  console.log("\n[1] agent-guard Host / X-Forwarded-Host / Origin / Referer & TRUST_PROXY");

  await withEnv(
    {
      TRUST_PROXY: undefined,
      BETTER_AUTH_URL: "https://app.example.com",
      BETTER_AUTH_TRUSTED_ORIGINS: undefined,
      ALLOWED_AGENT_HOSTS: undefined,
    },
    () => {
      // Spoofing x-forwarded-host without TRUST_PROXY
      assert.equal(
        assertTrustedHostAndOrigin(
          makeHeaderReq({ host: "evil.com", "x-forwarded-host": "localhost:3000" })
        )?.status,
        403,
        "host: evil.com + x-forwarded-host: localhost:3000 must 403 without TRUST_PROXY"
      );
      assert.equal(
        assertTrustedHostAndOrigin(
          makeHeaderReq({ host: "localhost:3000", "x-forwarded-host": "evil.com" })
        )?.status,
        403,
        "host: localhost:3000 + x-forwarded-host: evil.com must 403 without TRUST_PROXY"
      );
      assert.equal(
        assertTrustedHostAndOrigin(
          makeHeaderReq({
            host: "app.example.com",
            "x-forwarded-host": "localhost:9999",
            origin: "http://localhost:9999",
          })
        )?.status,
        403,
        "x-forwarded-host local-port mismatch must 403 without TRUST_PROXY"
      );
      assert.equal(
        assertTrustedHostAndOrigin(
          makeHeaderReq({
            host: "localhost:3000, evil.com",
          })
        )?.status,
        403,
        "comma-separated Host header must 403"
      );
      assert.equal(
        assertTrustedHostAndOrigin(
          makeHeaderReq({
            host: "localhost:3000",
            "x-forwarded-host": "localhost:3000, evil.com",
          })
        )?.status,
        403,
        "comma-separated x-forwarded-host must 403 without TRUST_PROXY"
      );
      assert.equal(
        assertTrustedHostAndOrigin(
          makeHeaderReq({
            host: "app.example.com",
            referer: "http://localhost:9999/attack",
          })
        )?.status,
        403,
        "mismatched non-explicit Referer must 403"
      );
      assert.equal(
        assertTrustedHostAndOrigin(
          makeHeaderReq({
            host: "app.example.com",
            referer: "https://app.example.com/agent",
          })
        ),
        null,
        "same-host Referer must be allowed"
      );
      assert.equal(
        assertTrustedHostAndOrigin(
          makeHeaderReq({
            host: "localhost:3000",
            "x-forwarded-host": "localhost:3000",
            origin: "http://localhost:3000",
          })
        ),
        null,
        "matching Host + X-Forwarded-Host + Origin must be allowed"
      );
    }
  );
  pass("Proxy spoofing & Referer checks blocked when TRUST_PROXY is off");

  for (const flag of ["true", "1", " TRUE "]) {
    await withEnv(
      {
        TRUST_PROXY: flag,
        BETTER_AUTH_URL: "https://app.example.com",
        BETTER_AUTH_TRUSTED_ORIGINS: undefined,
        ALLOWED_AGENT_HOSTS: undefined,
      },
      () => {
        assert.equal(
          assertTrustedHostAndOrigin(
            makeHeaderReq({
              host: "ticket-radar-app:3100",
              "x-forwarded-host": "app.example.com",
              origin: "https://app.example.com",
            })
          ),
          null,
          `TRUST_PROXY=${flag} allows trusted x-forwarded-host`
        );
        assert.equal(
          assertTrustedHostAndOrigin(
            makeHeaderReq({
              host: "ticket-radar-app:3100",
              "x-forwarded-host": "evil.com",
            })
          )?.status,
          403,
          `TRUST_PROXY=${flag} rejects untrusted x-forwarded-host`
        );
        assert.equal(
          assertTrustedHostAndOrigin(
            makeHeaderReq({
              host: "ticket-radar-app:3100",
              "x-forwarded-host": "localhost:3000, evil.com",
            })
          )?.status,
          403,
          `TRUST_PROXY=${flag} rejects comma-smuggled untrusted segment`
        );
        assert.equal(
          assertTrustedHostAndOrigin(
            makeHeaderReq({
              host: "ticket-radar-app:3100",
              "x-forwarded-host": "evil.com, app.example.com",
            })
          )?.status,
          403,
          `TRUST_PROXY=${flag} rejects untrusted leading segment`
        );
        assert.equal(
          assertTrustedHostAndOrigin(
            makeHeaderReq({
              host: "ticket-radar-app:3100",
              "x-forwarded-host": "app.example.com, ",
            })
          )?.status,
          403,
          `TRUST_PROXY=${flag} rejects trailing empty segment`
        );
        assert.equal(
          assertTrustedHostAndOrigin(
            makeHeaderReq({
              host: "ticket-radar-app:3100",
              "x-forwarded-host": "app.example.com, localhost:3000",
              origin: "http://localhost:3000",
            })
          ),
          null,
          `TRUST_PROXY=${flag} allows multi-hop when every segment is trusted`
        );
      }
    );
  }
  pass("TRUST_PROXY=true/1 validates all x-forwarded-host segments cleanly");
}

async function testWhitelistCacheInvalidation(): Promise<void> {
  console.log("\n[2] TrustWhitelist env cache invalidation");
  await withEnv(
    {
      TRUST_PROXY: undefined,
      BETTER_AUTH_URL: "https://base.example.com",
      BETTER_AUTH_TRUSTED_ORIGINS: undefined,
      ALLOWED_AGENT_HOSTS: "edge-a.example.com",
    },
    () => {
      assert.equal(
        assertTrustedHostAndOrigin(makeHeaderReq({ host: "edge-a.example.com" })),
        null
      );
      assert.equal(
        assertTrustedHostAndOrigin(makeHeaderReq({ host: "edge-b.example.com" }))?.status,
        403
      );

      process.env.ALLOWED_AGENT_HOSTS = "edge-b.example.com";
      assert.equal(
        assertTrustedHostAndOrigin(makeHeaderReq({ host: "edge-b.example.com" })),
        null,
        "Newly added ALLOWED_AGENT_HOSTS entry must work immediately"
      );
      assert.equal(
        assertTrustedHostAndOrigin(makeHeaderReq({ host: "edge-a.example.com" }))?.status,
        403,
        "Removed ALLOWED_AGENT_HOSTS entry must 403 immediately"
      );
    }
  );
  pass("Whitelist cache invalidates immediately on env mutation");
}

async function testRateLimitBucketsLruAndSweep(): Promise<void> {
  console.log("\n[3] Rate-limit buckets hard cap (1000), LRU eviction, and expired sweep");
  assert.equal(MAX_RATE_LIMIT_BUCKETS, 1000);

  await withEnv({ AGENT_RATE_LIMIT_PER_MIN: undefined }, () => {
    resetAgentRateLimitBucketsForTesting();
    assert.equal(getAgentRateLimitBucketCountForTesting(), 0);

    // 1. Insert 1500 distinct keys within 1s -> strictly bounded <= 1000
    for (let i = 0; i < 1500; i += 1) {
      const res = checkAgentRateLimit("m7-cap", `user-${i}`, 5);
      assert.equal(res, null);
    }
    assert.equal(
      getAgentRateLimitBucketCountForTesting(),
      MAX_RATE_LIMIT_BUCKETS,
      "Bucket map must stay capped at MAX_RATE_LIMIT_BUCKETS (1000)"
    );
    pass("Hard cap holds at 1000 across 1500 unique keys");

    // 2. Verify strict LRU ordering: touching oldest key keeps it alive, evicting next-oldest
    resetAgentRateLimitBucketsForTesting();
    for (let i = 0; i < MAX_RATE_LIMIT_BUCKETS; i += 1) {
      assert.equal(checkAgentRateLimit("m7-lru", `k-${i}`, 2), null);
    }
    // Touch k-0 (2nd hit, allowed) -> moves k-0 to MRU; k-1 is now LRU
    assert.equal(checkAgentRateLimit("m7-lru", "k-0", 2), null);
    // Insert k-1000 -> must evict k-1, NOT k-0
    assert.equal(checkAgentRateLimit("m7-lru", "k-1000", 2), null);
    assert.equal(getAgentRateLimitBucketCountForTesting(), MAX_RATE_LIMIT_BUCKETS);

    // k-0 still has 2 hits -> 3rd hit must 429
    assert.equal(
      checkAgentRateLimit("m7-lru", "k-0", 2)?.status,
      429,
      "Recently-used k-0 must survive eviction and block on 3rd hit"
    );
    // k-1 was evicted -> fresh bucket, 1st hit must pass (null)
    assert.equal(
      checkAgentRateLimit("m7-lru", "k-1", 2),
      null,
      "Least-recently-used k-1 must have been evicted"
    );
    pass("Strict LRU eviction keeps active keys and evicts oldest-accessed key");

    // 3. Verify throttled expired-entry sweep
    resetAgentRateLimitBucketsForTesting();
    const realNow = Date.now;
    let fakeNow = 1_700_000_000_000;
    Date.now = () => fakeNow;
    try {
      for (let i = 0; i < MAX_RATE_LIMIT_BUCKETS; i += 1) {
        assert.equal(checkAgentRateLimit("m7-sweep", `old-${i}`, 5), null);
      }
      assert.equal(getAgentRateLimitBucketCountForTesting(), MAX_RATE_LIMIT_BUCKETS);

      // Advance past 60s window and 1s sweep interval
      fakeNow += 65_000;
      assert.equal(checkAgentRateLimit("m7-sweep", "fresh-key", 5), null);
      assert.equal(
        getAgentRateLimitBucketCountForTesting(),
        1,
        "Expired buckets must be swept cleanly leaving only fresh-key"
      );
    } finally {
      Date.now = realNow;
      resetAgentRateLimitBucketsForTesting();
    }
    pass("Expired-entry sweep cleans stale buckets after window + sweep interval");
  });
}

async function testEnvRateLimitPrecedenceAndRoutes(): Promise<void> {
  console.log("\n[4] AGENT_RATE_LIMIT_PER_MIN precedence & route read/write granularity");

  // Precedence unit checks
  await withEnv({ AGENT_RATE_LIMIT_PER_MIN: "20" }, () => {
    resetAgentRateLimitBucketsForTesting();
    for (let i = 0; i < 3; i += 1) {
      assert.equal(checkAgentRateLimit("prec-3", "u1", 3), null);
    }
    const r4 = checkAgentRateLimit("prec-3", "u1", 3);
    assert.equal(r4?.status, 429);
    assert.ok(Number(r4?.headers.get("Retry-After")) >= 1);
  });

  await withEnv({ AGENT_RATE_LIMIT_PER_MIN: "200" }, () => {
    resetAgentRateLimitBucketsForTesting();
    for (let i = 0; i < 200; i += 1) {
      assert.equal(checkAgentRateLimit("prec-200", "u1", 25), null);
    }
    assert.equal(checkAgentRateLimit("prec-200", "u1", 25)?.status, 429);
  });

  await withEnv({ AGENT_RATE_LIMIT_PER_MIN: "5" }, () => {
    resetAgentRateLimitBucketsForTesting();
    for (let i = 0; i < 5; i += 1) {
      assert.equal(checkAgentRateLimit("prec-5", "u1", 120), null);
    }
    assert.equal(checkAgentRateLimit("prec-5", "u1", 120)?.status, 429);

    for (let i = 0; i < 3; i += 1) {
      assert.equal(checkAgentRateLimit("prec-5-strict", "u1", 3), null);
    }
    assert.equal(checkAgentRateLimit("prec-5-strict", "u1", 3)?.status, 429);
  });
  pass("AGENT_RATE_LIMIT_PER_MIN precedence (=20, >20, <20) verified");

  // Real route read granularity check (read-only GET endpoints)
  await withEnv({ AGENT_RATE_LIMIT_PER_MIN: "20" }, async () => {
    resetAgentRateLimitBucketsForTesting();
    const adminHeaders = await withAuthHeaders(undefined, "admin");
    for (let i = 0; i < 25; i += 1) {
      const res = await agentTasksGet(
        new Request("http://localhost:3000/api/agent/tasks", {
          method: "GET",
          headers: adminHeaders,
        })
      );
      assert.equal(res.status, 200, `GET /api/agent/tasks call #${i + 1} should succeed (>20)`);
    }

    const userHeaders = await withAuthHeaders(undefined, "user");
    let options429At = -1;
    for (let i = 0; i < 30; i += 1) {
      const res = await intakeOptionsGet(
        new Request("http://localhost:3000/api/intake/options", {
          method: "GET",
          headers: userHeaders,
        })
      );
      if (res.status === 429) {
        options429At = i + 1;
        break;
      }
      assert.equal(res.status, 200);
    }
    assert.equal(
      options429At,
      26,
      `GET /api/intake/options must hit 429 at call 26 (maxPerMinute=25), got ${options429At}`
    );
    resetAgentRateLimitBucketsForTesting();
  });
  pass("Real route GET /api/agent/tasks (>20) and GET /api/intake/options (25 -> 429 at 26) verified");

  // Verify all 12 route files / 13 handlers carry tiered maxPerMinute values
  const expectedLimits: Array<{ file: string; snippet: string }> = [
    { file: "app/api/agent/tasks/route.ts", snippet: "maxPerMinute: 120" },
    { file: "app/api/agent/report/route.ts", snippet: "maxPerMinute: 120" },
    { file: "app/api/intake/my-tickets/route.ts", snippet: "maxPerMinute: 120" },
    { file: "app/api/intake/options/route.ts", snippet: "maxPerMinute: 25" },
    { file: "app/api/agent/tasks/[id]/route.ts", snippet: "maxPerMinute: 30" },
    { file: "app/api/intake/my-tickets/[id]/reopen/route.ts", snippet: "maxPerMinute: 20" },
    { file: "app/api/agent/outreach/voice-turn/route.ts", snippet: "maxPerMinute: 20" },
    { file: "app/api/intake/chat/route.ts", snippet: "maxPerMinute: 20" },
    { file: "app/api/intake/submit/route.ts", snippet: "maxPerMinute: 15" },
    { file: "app/api/copilot/route.ts", snippet: "maxPerMinute: 15" },
    { file: "app/api/sandbox/xray/route.ts", snippet: "maxPerMinute: 15" },
    { file: "app/api/agent/patrol/route.ts", snippet: "maxPerMinute: 10" },
    { file: "app/api/agent/report/route.ts", snippet: "maxPerMinute: 10" },
  ];
  for (const item of expectedLimits) {
    const content = fs.readFileSync(path.join(process.cwd(), item.file), "utf8");
    assert.ok(
      content.includes(item.snippet),
      `${item.file} must include ${item.snippet}`
    );
  }
  pass("All 13 guarded route handlers declare tiered maxPerMinute");
}

function testCsvSanitizationAndExports(): void {
  console.log("\n[5] CSV CWE-1236 sanitizeCsvCell, buildSafeCsv, exportThemesToCSV, exportThemeTicketsToCSV");

  const dangerousPayloads = [
    "=1+1",
    "+cmd|'/C calc'!A0",
    "-2+3",
    "-123",
    "@SUM(1,1)",
    "\t=1+1",
    "\tfoo",
    "\r=1+1",
    "\rfoo",
    "  =1+1",
    "\n+1+1",
    "\u00A0-1",
    "\u3000@SUM(1)",
    "\uFEFF=1+1",
    "\u200B=1+1",
  ];
  for (const payload of dangerousPayloads) {
    assert.equal(
      sanitizeCsvCell(payload),
      `'${payload}`,
      `Formula payload must be prefixed with ': ${JSON.stringify(payload)}`
    );
  }

  assert.equal(sanitizeCsvCell(42), "42");
  assert.equal(sanitizeCsvCell(0), "0");
  assert.equal(sanitizeCsvCell(-42), "-42");
  assert.equal(sanitizeCsvCell(-3.14), "-3.14");
  assert.equal(sanitizeCsvCell(true), "true");
  assert.equal(sanitizeCsvCell(false), "false");
  assert.equal(sanitizeCsvCell(BigInt("9007199254740993")), "9007199254740993");
  assert.equal(
    sanitizeCsvCell(new Date("2026-11-21T00:00:00.000Z")),
    "2026-11-21T00:00:00.000Z"
  );
  assert.equal(sanitizeCsvCell(new Date("invalid")), "");
  assert.equal(sanitizeCsvCell(null), "");
  assert.equal(sanitizeCsvCell(undefined), "");
  assert.equal(sanitizeCsvCell(Number.NaN), "");
  assert.equal(sanitizeCsvCell(Number.POSITIVE_INFINITY), "");
  assert.equal(sanitizeCsvCell("正常文本=1"), "正常文本=1");
  assert.equal(sanitizeCsvCell("2026-11-21"), "2026-11-21");
  assert.equal(sanitizeCsvCell("'=1+1"), "'=1+1");
  pass("sanitizeCsvCell neutralizes triggers and preserves safe primitive values");

  const csv = buildSafeCsv(
    ["title", "=badHeader", "notes"],
    [
      ['=HYPERLINK("http://evil.com","click")', -5, 'hello, "world"\nline2'],
      ["+cmd", null, "\t=SUM(A1:A2)"],
    ]
  );
  assert.ok(!csv.startsWith("\uFEFF"), "buildSafeCsv defaults includeBom to false");
  const parsed = Papa.parse<string[]>(csv, { header: false });
  assert.deepEqual(parsed.data, [
    ["title", "'=badHeader", "notes"],
    ['\'=HYPERLINK("http://evil.com","click")', "-5", 'hello, "world"\nline2'],
    ["'+cmd", "", "'\t=SUM(A1:A2)"],
  ]);

  assert.equal(buildSafeCsv(["a", "b"], []), "a,b");
  assert.equal(buildSafeCsv([], []), "");
  assert.equal(buildSafeCsv(["a", "b"], [[1, 2]], { includeBom: true }), "\uFEFFa,b\r\n1,2");
  pass("buildSafeCsv RFC-4180 quoting, CWE-1236, empty rows, and BOM option verified");

  // Test exportThemesToCSV, exportThemeTicketsToCSV, exportSingleThemeTicketsToCSV
  assert.equal(exportSingleThemeTicketsToCSV, exportThemeTicketsToCSV);
  const captured: Array<{ content: string; filename: string; type: string }> = [];

  const prevDocument = globalThis.document;
  const prevCreateObjectURL = URL.createObjectURL;
  const prevRevokeObjectURL = URL.revokeObjectURL;
  const prevBlob = globalThis.Blob;

  class MockBlob {
    parts: unknown[];
    type: string;
    constructor(parts: unknown[], options?: { type?: string }) {
      this.parts = parts;
      this.type = options?.type ?? "";
    }
  }

  let latestFilename = "";
  const mockLink = {
    setAttribute(name: string, value: string) {
      if (name === "download") latestFilename = value;
    },
    click() {},
  };

  try {
    (globalThis as { Blob: unknown }).Blob = MockBlob;
    (globalThis as { document: unknown }).document = {
      createElement: () => mockLink,
      body: {
        appendChild: () => {},
        removeChild: () => {},
      },
    };
    URL.createObjectURL = ((blob: unknown) => {
      const b = blob as MockBlob;
      captured.push({
        content: String(b.parts[0] ?? ""),
        filename: latestFilename || "pending",
        type: b.type,
      });
      return "blob:mock";
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;

    const sampleTheme: MultiFrequencyTheme = {
      id: "TH-1",
      title: "=HYPERLINK(\"http://evil.com\",\"theme\")",
      canonicalSubject: "+SUBJ",
      canonicalLocation: "-LOC",
      eventType: "@EVT",
      category: "城市治理",
      riskLevel: "HIGH",
      riskReason: "test",
      ticketCount: 2,
      timeSpanHours: 12,
      firstOccurrence: "2026-11-21T00:00:00Z",
      lastOccurrence: "2026-11-21T12:00:00Z",
      aiSummary: "\t=1+1",
      recommendedAction: "  +ACT",
      handlingStatus: "PENDING",
      handlingProgress: 0,
      status: "CONFIRMED",
      relatedSubjects: ["=SUBJ1"],
      relatedLocations: ["LOC1"],
      tickets: [
        {
          id: "tk-1",
          ticketNo: "=TK1",
          title: "t1",
          content: "+payload",
          citizenName: "-张三",
          citizenPhone: "13800000000",
          district: "天河区",
          subdistrict: "车陂街道",
          channel: "热线",
          canonicalSubject: "@subject",
          canonicalLocation: "LOC1",
          eventType: "\tnoise",
          status: "PENDING",
          createTime: "2026-11-21T01:00:00Z",
          sourceCategory: "城市治理",
          urgency: "NORMAL",
          confidence: 90,
          entities: [],
          relations: [],
          themes: [],
        },
      ],
    };

    exportThemesToCSV([sampleTheme]);
    exportThemeTicketsToCSV(sampleTheme);

    assert.equal(captured.length, 2);
    for (const item of captured) {
      assert.ok(item.content.startsWith("\uFEFF"), "Exported CSV must include UTF-8 BOM");
      assert.equal(item.type, "text/csv;charset=utf-8;");
    }

    const themesParsed = Papa.parse<Record<string, string>>(captured[0].content.slice(1), {
      header: true,
    });
    assert.equal(themesParsed.data[0].title, '\'=HYPERLINK("http://evil.com","theme")');
    assert.equal(themesParsed.data[0].canonicalSubject, "'+SUBJ");
    assert.equal(themesParsed.data[0].aiSummary, "'\t=1+1");
    assert.equal(themesParsed.data[0].recommendedAction, "'  +ACT");
    assert.equal(themesParsed.data[0].ticketNos, "'=TK1");
    assert.equal(themesParsed.data[0].ticketCount, "2");

    const ticketsParsed = Papa.parse<Record<string, string>>(captured[1].content.slice(1), {
      header: true,
    });
    assert.equal(ticketsParsed.data[0].ticketNo, "'=TK1");
    assert.equal(ticketsParsed.data[0].citizenName, "'-张三");
    assert.equal(ticketsParsed.data[0].canonicalSubject, "'@subject");
    assert.equal(ticketsParsed.data[0].eventType, "'\tnoise");
    assert.equal(ticketsParsed.data[0].content, "'+payload");
  } finally {
    (globalThis as { document: unknown }).document = prevDocument;
    URL.createObjectURL = prevCreateObjectURL;
    URL.revokeObjectURL = prevRevokeObjectURL;
    (globalThis as { Blob: unknown }).Blob = prevBlob;
  }
  pass("exportThemesToCSV & exportThemeTicketsToCSV sanitize all fields and keep BOM/headers");
}

function testLoginRedirectHardening(): void {
  console.log("\n[6] Login ?from= open-redirect hardening");

  const unsafeInputs: Array<string | null | undefined> = [
    "//evil.com",
    "///evil.com",
    "https://evil.com",
    "http://evil.com/phish",
    "/\\evil.com",
    "/foo\\evil.com",
    "javascript:alert(1)",
    "/\t/evil.com",
    "/\n/evil.com",
    "/\r/evil.com",
    "/\x00/evil.com",
    "/\x7f/evil.com",
    "/..//evil.com",
    "/",
    "/?tab=a",
    "",
    null,
    undefined,
  ];
  for (const input of unsafeInputs) {
    assert.equal(
      isSafeRedirectFrom(input),
      false,
      `isSafeRedirectFrom must reject ${JSON.stringify(input)}`
    );
    assert.equal(resolvePostLoginTarget("admin", input), "/");
    assert.equal(resolvePostLoginTarget("user", input), "/submit");
  }

  for (const loginLoop of ["/login", "/login?from=//evil.com", "/login/extra"]) {
    assert.equal(resolvePostLoginTarget("admin", loginLoop), "/");
    assert.equal(resolvePostLoginTarget("user", loginLoop), "/submit");
  }

  // Role guard with query, hash, and dot-segment normalization
  assert.equal(isAdminRoutePath("/themes?tab=a"), true);
  assert.equal(isAdminRoutePath("/submit/../themes"), true);
  assert.equal(resolvePostLoginTarget("user", "/themes?tab=a"), "/submit");
  assert.equal(resolvePostLoginTarget("user", "/tickets?tab=review#1"), "/submit");
  assert.equal(resolvePostLoginTarget("user", "/submit/../themes"), "/submit");
  assert.equal(resolvePostLoginTarget("admin", "/themes/123?tab=a"), "/themes/123?tab=a");
  assert.equal(resolvePostLoginTarget("user", "/submit?draft=1"), "/submit?draft=1");

  // Client-safe boundary check
  const redirectModuleSrc = fs.readFileSync(
    path.join(process.cwd(), "lib/security/login-redirect.ts"),
    "utf8"
  );
  for (const forbidden of ["next/headers", "next/navigation", "@/db/client", "@/lib/auth/rbac", "@/lib/auth/config"]) {
    assert.ok(
      !redirectModuleSrc.includes(forbidden),
      `lib/security/login-redirect.ts must remain client-safe (no ${forbidden})`
    );
  }
  const loginPageSrc = fs.readFileSync(
    path.join(process.cwd(), "app/login/page.tsx"),
    "utf8"
  );
  assert.ok(
    loginPageSrc.includes("@/lib/security/login-redirect"),
    "app/login/page.tsx must import resolvePostLoginTarget from @/lib/security/login-redirect"
  );
  pass("Login ?from= open-redirect & client-safety checks passed");
}

async function main(): Promise<void> {
  console.log("=== M7 P1 Security Guard & CSV Injection Test Suite ===");
  await testAgentGuardHostAndProxy();
  await testWhitelistCacheInvalidation();
  await testRateLimitBucketsLruAndSweep();
  await testEnvRateLimitPrecedenceAndRoutes();
  testCsvSanitizationAndExports();
  testLoginRedirectHardening();
  console.log(`\nALL M7 CHECKS PASSED (${passed} groups)!`);
  process.exit(0);
}

main().catch((err) => {
  console.error("\nM7 TEST FAILED:", err);
  process.exit(1);
});
