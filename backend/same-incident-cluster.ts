/**
 * 同一件事才并成主题：规则对得上，或者抽取产物的向量很近且是同一个具体地点。
 * 向量由调用方算好传进来，这里不再请求模型。
 */
import type { IncidentProfile } from "./ticket-profile";
import { incidentsMatch } from "./ticket-profile";
import { RULES } from "./rules";

function envFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : fallback;
}

export const PRODUCT_COSINE_MIN = envFloat("PRODUCT_COSINE_MIN", 0.85);

const COMPOUND_KEYWORD = /学府|花园|小区|公寓|大厦|工业区|美食城|公园|新村|苑/g;
const DOOR_NUMBER = /\d+(?:、\d+)*号/;
const ADMIN_SPLIT = /街道|镇|乡|社区|居委会|村委会/g;

export interface IncidentLinkCandidate {
  profile: IncidentProfile;
  category: string;
  township: string;
  placeEvidence: string;
  subject: string;
  vector: number[];
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || left.length !== right.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let i = 0; i < left.length; i++) {
    dot += left[i] * right[i];
    leftNorm += left[i] * left[i];
    rightNorm += right[i] * right[i];
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / Math.sqrt(leftNorm * rightNorm);
}

/** 小区、学府、美食城这类地名。路名本身不算，避免整条路被并成一件事。 */
export function compoundCores(text: string): string[] {
  const cores: string[] = [];
  const seen = new Set<string>();
  const pattern = new RegExp(COMPOUND_KEYWORD.source, "g");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const before = text.slice(0, match.index);
    const splits = [...before.matchAll(new RegExp(ADMIN_SPLIT.source, "g"))];
    const last = splits[splits.length - 1];
    const tail = last ? before.slice(last.index + last[0].length) : before;
    const name = `${tail.slice(-8)}${match[0]}`.replace(/^[^\u4e00-\u9fa5]+/, "");
    if (name.length < 4 || seen.has(name)) continue;
    seen.add(name);
    cores.push(name);
  }
  return cores;
}

export function isConcretePlace(text: string): boolean {
  const value = text.trim();
  if (!value || RULES.adminOnlyLocation.test(value)) return false;
  if (compoundCores(value).length > 0) return true;
  return RULES.microLocationHint.test(value);
}

/** 门牌不一致直接否掉。其余要靠同一个小区或地标，不靠共用的路名。 */
export function sameConcretePlace(leftText: string, rightText: string): boolean {
  const left = leftText.trim();
  const right = rightText.trim();
  if (!left || !right) return false;
  const doorLeft = left.match(DOOR_NUMBER)?.[0];
  const doorRight = right.match(DOOR_NUMBER)?.[0];
  if (doorLeft && doorRight && doorLeft !== doorRight) return false;
  return coresOverlap(compoundCores(left), compoundCores(right));
}

export function sameNamedSubject(leftText: string, rightText: string): boolean {
  const left = leftText.trim();
  const right = rightText.trim();
  if (left.length < 4 || right.length < 4) return false;
  if (isGenericSubject(left) || isGenericSubject(right)) return false;
  return left === right || left.includes(right) || right.includes(left);
}

export function shouldLinkIncidents(left: IncidentLinkCandidate, right: IncidentLinkCandidate): boolean {
  if (incidentsMatch(left.profile, right.profile)) return true;
  if (cosineSimilarity(left.vector, right.vector) < PRODUCT_COSINE_MIN) return false;
  const categoryLeft = left.category.trim();
  const categoryRight = right.category.trim();
  if (!categoryLeft || categoryLeft !== categoryRight) return false;
  const townLeft = left.township.trim();
  const townRight = right.township.trim();
  if (!townLeft || townLeft !== townRight) return false;
  if (!isConcretePlace(left.placeEvidence) || !isConcretePlace(right.placeEvidence)) return false;
  if (sameConcretePlace(left.placeEvidence, right.placeEvidence)) return true;
  if (sameNamedSubject(left.subject, right.subject)) return true;
  return false;
}

export function clusterLinked<T>(
  items: T[],
  read: (item: T, index: number) => IncidentLinkCandidate
): T[][] {
  const candidates = items.map((item, index) => read(item, index));
  const parent = items.map((_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    let cursor = index;
    while (parent[cursor] !== root) {
      const next = parent[cursor];
      parent[cursor] = root;
      cursor = next;
    }
    return root;
  };
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (!shouldLinkIncidents(candidates[i], candidates[j])) continue;
      const left = find(i);
      const right = find(j);
      if (left !== right) parent[right] = left;
    }
  }
  const buckets = new Map<number, T[]>();
  for (let i = 0; i < items.length; i++) {
    const root = find(i);
    const list = buckets.get(root);
    if (list) list.push(items[i]);
    else buckets.set(root, [items[i]]);
  }
  return [...buckets.values()].filter((group) => group.length >= 2).sort((a, b) => b.length - a.length);
}

/** 主题名称优先用大家一致的具体主体，否则用共同的小区或地标，不用「市民」。 */
export function chooseThemeAnchor(input: {
  subjects: string[];
  placeEvidence: string[];
  eventType: string;
}): string {
  const usable = input.subjects.map((subject) => subject.trim()).filter((subject) => subject.length >= 2 && !isGenericSubject(subject));
  const agreed = usable.find((subject) =>
    input.subjects.every((raw) => {
      const text = raw.trim();
      if (!text || isGenericSubject(text)) return false;
      return text === subject || text.includes(subject) || subject.includes(text);
    })
  );
  if (agreed) return agreed;

  const lists = input.placeEvidence.map((text) => compoundCores(text));
  if (lists.length >= 2 && lists.every((list) => list.length > 0)) {
    for (const core of lists[0]) {
      if (core.length < 4) continue;
      const shared = lists.every((list) => list.some((other) => other === core || other.includes(core) || core.includes(other)));
      if (shared) {
        const shortest = lists
          .flat()
          .filter((other) => other === core || other.includes(core) || core.includes(other))
          .sort((a, b) => a.length - b.length)[0];
        return shortest || core;
      }
    }
  }

  if (usable.length > 0) return majorityText(usable) || usable[0];
  const eventType = input.eventType.trim();
  return eventType || "同类诉求";
}

function coresOverlap(left: string[], right: string[]): boolean {
  return left.some((coreLeft) =>
    right.some(
      (coreRight) =>
        coreLeft.length >= 4 &&
        coreRight.length >= 4 &&
        (coreLeft === coreRight || coreLeft.includes(coreRight) || coreRight.includes(coreLeft))
    )
  );
}

function isGenericSubject(value: string): boolean {
  return (RULES.genericSubjects as readonly string[]).includes(value) || RULES.genericSubjectSuffix.test(value);
}

function majorityText(values: string[]): string | null {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  let best: string | null = null;
  let count = 0;
  for (const [value, n] of counts) {
    if (n > count) {
      best = value;
      count = n;
    }
  }
  return best;
}
