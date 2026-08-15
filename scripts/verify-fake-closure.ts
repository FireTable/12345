import { markFakeClosures } from "../backend/node/fake-closure";
import { RULES } from "../backend/rules";
import type { EnrichedTicket } from "../backend/state";

function stub(partial: Partial<EnrichedTicket> & { id: string; createTime: string }): EnrichedTicket {
  return {
    ticketNo: partial.id,
    title: "",
    citizenName: "市民*",
    citizenPhone: "",
    district: "",
    subdistrict: "",
    content: "噪音扰民",
    channel: "市民服务热线",
    status: "PENDING",
    entities: [],
    relations: [],
    themes: [],
    canonicalSubject: "招财宝民宿",
    canonicalLocation: "某镇某路10号",
    eventType: "噪音扰民",
    ...partial,
  };
}

function isoDaysAgo(days: number, hour = "10:00:00"): string {
  const d = new Date("2026-08-15T00:00:00");
  d.setDate(d.getDate() - days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day} ${hour}`;
}

function assert(name: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) process.exitCode = 1;
}

const windowDays = RULES.fakeClosure.windowDays;

const A = stub({
  id: "A",
  createTime: isoDaysAgo(windowDays),
  closedAt: isoDaysAgo(Math.max(1, Math.floor(windowDays / 2))),
  closureStatus: "RESOLVED",
});
const B = stub({ id: "B", createTime: isoDaysAgo(windowDays - 1) });
const C = stub({ id: "C", createTime: isoDaysAgo(1) });
const r1 = markFakeClosures([A, B, C]);
assert("窗口内再投标假闭环", C.isFakeClosure === true && C.closureStatus === "REOPENED");
assert("reopenTicketIds 含 C", r1.reopenTicketIds.includes("C"));

const D = stub({
  id: "D",
  createTime: isoDaysAgo(windowDays + 40),
  closedAt: isoDaysAgo(windowDays + 20),
  closureStatus: "RESOLVED",
});
const E = stub({ id: "E", createTime: isoDaysAgo(1) });
const r2 = markFakeClosures([D, E]);
assert("超出窗口不触发", E.isFakeClosure !== true && r2.reopenCount === 0);

if (process.exitCode) {
  console.error("verify-fake-closure failed");
  process.exit(1);
}
console.log("verify-fake-closure passed");
