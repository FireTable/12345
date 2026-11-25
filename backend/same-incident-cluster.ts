/**
 * 同一件事才并成主题：规则对得上，或者抽取产物的向量很近且是同一个具体地点。
 * 向量由调用方算好传进来，这里不再请求模型。
 */
import type { IncidentProfile } from "./ticket-profile";
import { incidentsMatch, ISSUE_FAMILY } from "./ticket-profile";
import { isSameSpatialEntity } from "./node/canonical-node";
import { RULES, isGenericOrPlaceholderSubject } from "./rules";
import { canonicalizeCategory } from "@/lib/vocabulary";

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

const WILDCARD_CATEGORIES = new Set(["", "综合民生", "其他", "未分类"]);

function normalizeCategoryValue(category?: string | null): string {
  const trimmed = (category || "").trim();
  if (WILDCARD_CATEGORIES.has(trimmed)) return trimmed;
  return canonicalizeCategory(trimmed) || trimmed;
}

export function categoriesCompatible(leftCategory?: string | null, rightCategory?: string | null): boolean {
  const left = normalizeCategoryValue(leftCategory);
  const right = normalizeCategoryValue(rightCategory);
  if (WILDCARD_CATEGORIES.has(left) || WILDCARD_CATEGORIES.has(right)) return true;
  return left === right;
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
    if (name.length < 4 || /某/.test(name) || seen.has(name)) continue;
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
  if (isGenericOrPlaceholderSubject(left) || isGenericOrPlaceholderSubject(right)) return false;
  if (isGenericSubject(left) || isGenericSubject(right)) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function sameMicroLocation(leftPlace?: string | null, rightPlace?: string | null): boolean {
  const left = (leftPlace || "").trim();
  const right = (rightPlace || "").trim();
  if (!left || !right || !isConcretePlace(left) || !isConcretePlace(right)) return false;
  if (!isSameSpatialEntity(left, right)) return false;
  const doorLeft = left.match(DOOR_NUMBER)?.[0];
  const doorRight = right.match(DOOR_NUMBER)?.[0];
  if (doorLeft && doorRight) return doorLeft === doorRight;
  if (doorLeft || doorRight) return false;
  return coresOverlap(compoundCores(left), compoundCores(right));
}

function hasDoorConflict(leftText: string, rightText: string): boolean {
  const doorLeft = leftText.match(DOOR_NUMBER)?.[0];
  const doorRight = rightText.match(DOOR_NUMBER)?.[0];
  return Boolean(doorLeft && doorRight && doorLeft !== doorRight);
}

export function shouldLinkIncidents(left: IncidentLinkCandidate, right: IncidentLinkCandidate): boolean {
  if (!categoriesCompatible(left.category, right.category)) return false;
  if (incidentsMatch(left.profile, right.profile)) return true;
  if (cosineSimilarity(left.vector, right.vector) < PRODUCT_COSINE_MIN) return false;
  if (left.profile.family && right.profile.family && left.profile.family !== right.profile.family) return false;

  const categoryLeft = left.category.trim();
  const categoryRight = right.category.trim();
  if (!categoryLeft || categoryLeft !== categoryRight) return false;
  const townLeft = left.township.trim();
  const townRight = right.township.trim();
  if (!townLeft || townLeft !== townRight) return false;

  if (
    left.profile.place &&
    right.profile.place &&
    isConcretePlace(left.profile.place) &&
    isConcretePlace(right.profile.place) &&
    !isSameSpatialEntity(left.profile.place, right.profile.place)
  ) {
    return false;
  }

  if (!isConcretePlace(left.placeEvidence) || !isConcretePlace(right.placeEvidence)) return false;

  const isWageArrears =
    left.profile.family === ISSUE_FAMILY.WAGE_ARREARS ||
    right.profile.family === ISSUE_FAMILY.WAGE_ARREARS;
  if (isWageArrears) {
    if (hasDoorConflict(left.placeEvidence, right.placeEvidence)) return false;
    const sharedSubject =
      sameNamedSubject(left.subject, right.subject) ||
      Boolean(
        left.profile.subject &&
          right.profile.subject &&
          sameNamedSubject(left.profile.subject, right.profile.subject)
      );
    const sameMicro =
      sameConcretePlace(left.placeEvidence, right.placeEvidence) ||
      sameMicroLocation(left.profile.place, right.profile.place);
    return sharedSubject || sameMicro;
  }

  if (sameConcretePlace(left.placeEvidence, right.placeEvidence)) return true;
  if (sameNamedSubject(left.subject, right.subject)) return true;
  return false;
}

interface ComponentMeta {
  categories: Map<string, number>;
  hasWageArrears: boolean;
  wagePlaces: string[];
  wageSubjects: string[];
}

function buildSingletonMeta(candidate: IncidentLinkCandidate): ComponentMeta {
  const categories = new Map<string, number>();
  const normCat = normalizeCategoryValue(candidate.category);
  if (normCat && !WILDCARD_CATEGORIES.has(normCat)) {
    categories.set(normCat, 1);
  }
  const hasWageArrears = candidate.profile.family === ISSUE_FAMILY.WAGE_ARREARS;
  const wagePlaces: string[] = [];
  const wageSubjects: string[] = [];
  if (hasWageArrears) {
    const place = (candidate.profile.place || "").trim();
    if (place && isConcretePlace(place)) wagePlaces.push(place);
    for (const rawSubj of [candidate.profile.subject, candidate.subject]) {
      const s = (rawSubj || "").trim();
      if (s.length >= 4 && !isGenericOrPlaceholderSubject(s) && !isGenericSubject(s) && !wageSubjects.includes(s)) {
        wageSubjects.push(s);
      }
    }
  }
  return { categories, hasWageArrears, wagePlaces, wageSubjects };
}

function dominantConcreteCategory(meta: ComponentMeta): string | null {
  let best: string | null = null;
  let bestCount = 0;
  for (const [cat, count] of meta.categories) {
    if (count > bestCount) {
      best = cat;
      bestCount = count;
    }
  }
  return best;
}

function canMergeMeta(left: ComponentMeta, right: ComponentMeta): boolean {
  const domLeft = dominantConcreteCategory(left);
  const domRight = dominantConcreteCategory(right);
  if (domLeft && domRight && !categoriesCompatible(domLeft, domRight)) return false;
  for (const catLeft of left.categories.keys()) {
    for (const catRight of right.categories.keys()) {
      if (!categoriesCompatible(catLeft, catRight)) return false;
    }
  }
  if (left.hasWageArrears || right.hasWageArrears) {
    for (const pLeft of left.wagePlaces) {
      for (const pRight of right.wagePlaces) {
        if (!isSameSpatialEntity(pLeft, pRight) || hasDoorConflict(pLeft, pRight)) {
          return false;
        }
      }
    }
    if (left.wageSubjects.length > 0 && right.wageSubjects.length > 0) {
      const sharesSubject = left.wageSubjects.some((sLeft) =>
        right.wageSubjects.some((sRight) => sameNamedSubject(sLeft, sRight))
      );
      if (!sharesSubject) return false;
    }
  }
  return true;
}

export function createGuardedIncidentUnion(candidates: IncidentLinkCandidate[]): {
  parent: number[];
  find: (index: number) => number;
  unite: (left: number, right: number) => boolean;
} {
  const parent = candidates.map((_, index) => index);
  const mergedMeta = new Map<number, ComponentMeta>();

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

  const getMeta = (root: number): ComponentMeta => {
    const existing = mergedMeta.get(root);
    if (existing) return existing;
    return buildSingletonMeta(candidates[root]);
  };

  const unite = (left: number, right: number): boolean => {
    const a = find(left);
    const b = find(right);
    if (a === b) return true;
    const metaA = getMeta(a);
    const metaB = getMeta(b);
    if (!canMergeMeta(metaA, metaB)) return false;

    parent[b] = a;
    for (const [cat, count] of metaB.categories) {
      metaA.categories.set(cat, (metaA.categories.get(cat) || 0) + count);
    }
    if (metaB.hasWageArrears) metaA.hasWageArrears = true;
    for (const p of metaB.wagePlaces) {
      if (!metaA.wagePlaces.includes(p)) metaA.wagePlaces.push(p);
    }
    for (const s of metaB.wageSubjects) {
      if (!metaA.wageSubjects.includes(s)) metaA.wageSubjects.push(s);
    }
    mergedMeta.set(a, metaA);
    mergedMeta.delete(b);
    return true;
  };

  return { parent, find, unite };
}

export function clusterLinked<T>(
  items: T[],
  read: (item: T, index: number) => IncidentLinkCandidate
): T[][] {
  const candidates = items.map((item, index) => read(item, index));
  const union = createGuardedIncidentUnion(candidates);
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (!shouldLinkIncidents(candidates[i], candidates[j])) continue;
      union.unite(i, j);
    }
  }
  const buckets = new Map<number, T[]>();
  for (let i = 0; i < items.length; i++) {
    const root = union.find(i);
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
  return (
    isGenericOrPlaceholderSubject(value) ||
    (RULES.genericSubjects as readonly string[]).includes(value) ||
    RULES.genericSubjectSuffix.test(value)
  );
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
