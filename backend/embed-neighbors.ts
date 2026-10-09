/**
 * 库存向量的近邻只是候选人。并案仍走 shouldLinkIncidents。
 * HNSW 在回填写行期间不建。
 */
import { incidentsMatch, type IncidentProfile } from "./ticket-profile";
import {
  cosineSimilarity,
  shouldLinkIncidents,
  type IncidentLinkCandidate,
} from "./same-incident-cluster";
import { yieldToEventLoop } from "@/lib/yield-loop";

export const HNSW_M = 16;
export const HNSW_EF_CONSTRUCTION = 64;
export const HNSW_EF_SEARCH = 40;
export const NEIGHBOR_K = 20;

export function hnswCreateIndexSql(backfillInProgress: boolean): string | null {
  if (backfillInProgress) return null;
  return `CREATE INDEX IF NOT EXISTS idx_ticket_embeddings_hnsw ON ticket_embeddings USING hnsw (embedding halfvec_cosine_ops) WITH (m = ${HNSW_M}, ef_construction = ${HNSW_EF_CONSTRUCTION})`;
}

/** 查询只读 ticket_embeddings，先按分类和镇街过滤，再取余弦最近的 20 条。 */
export function neighborLookupSql(): string {
  return [
    `SET hnsw.ef_search = ${HNSW_EF_SEARCH}`,
    "SELECT e2.ticket_id",
    "FROM ticket_embeddings e",
    "JOIN tickets t ON t.id = e.ticket_id",
    "JOIN ticket_embeddings e2 ON e2.ticket_id <> e.ticket_id",
    "JOIN tickets t2 ON t2.id = e2.ticket_id",
    "WHERE e.ticket_id = $1",
    "AND t2.source_category = t.source_category",
    "AND t2.subdistrict = t.subdistrict",
    "ORDER BY e2.embedding <=> e.embedding",
    `LIMIT ${NEIGHBOR_K}`,
  ].join("\n");
}

export function rankNeighborIndexes(
  candidates: Array<{ category: string; township: string; vector: number[] }>,
  k: number = NEIGHBOR_K
): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  const seen = new Set<string>();
  for (let i = 0; i < candidates.length; i++) {
    const category = candidates[i].category.trim();
    const township = candidates[i].township.trim();
    if (!category || !township) continue;
    const scored: Array<{ index: number; score: number }> = [];
    for (let j = 0; j < candidates.length; j++) {
      if (i === j) continue;
      if (candidates[j].category.trim() !== category) continue;
      if (candidates[j].township.trim() !== township) continue;
      scored.push({ index: j, score: cosineSimilarity(candidates[i].vector, candidates[j].vector) });
    }
    scored.sort((left, right) => right.score - left.score || left.index - right.index);
    for (const neighbor of scored.slice(0, k)) {
      const left = Math.min(i, neighbor.index);
      const right = Math.max(i, neighbor.index);
      const key = `${left}:${right}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push([left, right]);
    }
  }
  return pairs;
}

function createUnion(count: number): {
  parent: number[];
  unite: (left: number, right: number) => void;
} {
  const parent = Array.from({ length: count }, (_, index) => index);
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
  return {
    parent,
    unite(left: number, right: number) {
      const a = find(left);
      const b = find(right);
      if (a !== b) parent[b] = a;
    },
  };
}

function linkPair(
  candidates: IncidentLinkCandidate[],
  neighborKeys: Set<string>,
  left: number,
  right: number,
  unite: (left: number, right: number) => void
) {
  const i = Math.min(left, right);
  const j = Math.max(left, right);
  if (i === j) return;
  const rule = incidentsMatch(candidates[i].profile, candidates[j].profile);
  if (!neighborKeys.has(`${i}:${j}`) && !rule) return;
  if (!shouldLinkIncidents(candidates[i], candidates[j])) return;
  unite(i, j);
}

function groupsFromParent<T>(items: T[], parent: number[]): T[][] {
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
  const buckets = new Map<number, T[]>();
  for (let index = 0; index < items.length; index++) {
    const root = find(index);
    const list = buckets.get(root);
    if (list) list.push(items[index]);
    else buckets.set(root, [items[index]]);
  }
  return [...buckets.values()].filter((group) => group.length >= 2).sort((left, right) => right.length - left.length);
}

/** 规则不可能成立的对不必两两比。指纹相同，或同事件且镇街不冲突，才可能 incidentsMatch。 */
function ruleCouldMatch(left: IncidentProfile, right: IncidentProfile): boolean {
  if (
    left.fingerprint &&
    left.fingerprint === right.fingerprint &&
    (!left.family || !right.family || left.family === right.family)
  ) {
    return true;
  }
  if (!left.family || left.family !== right.family) return false;
  if (left.township && right.township && left.township !== right.township) return false;
  return true;
}

/**
 * 近邻对里仍要过 shouldLinkIncidents。规则对得上的对，即使不在前 20，也保留。
 * 这个同步版本留给小样本。全市工单走 clusterFromStoredNeighborsYielding。
 */
export function clusterFromStoredNeighbors<T>(
  items: T[],
  read: (item: T, index: number) => IncidentLinkCandidate,
  neighborPairs?: Array<[number, number]>
): T[][] {
  const candidates = items.map((item, index) => read(item, index));
  const pairs = neighborPairs ?? rankNeighborIndexes(candidates);
  const neighborKeys = new Set(pairs.map(([left, right]) => `${Math.min(left, right)}:${Math.max(left, right)}`));
  const union = createUnion(items.length);
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      linkPair(candidates, neighborKeys, i, j, union.unite);
    }
  }
  return groupsFromParent(items, union.parent);
}

async function rankNeighborIndexesYielding(
  candidates: Array<{ category: string; township: string; vector: number[] }>,
  k: number = NEIGHBOR_K
): Promise<Array<[number, number]>> {
  const pairs: Array<[number, number]> = [];
  const seen = new Set<string>();
  let steps = 0;
  for (let i = 0; i < candidates.length; i++) {
    const category = candidates[i].category.trim();
    const township = candidates[i].township.trim();
    if (!category || !township) continue;
    const scored: Array<{ index: number; score: number }> = [];
    for (let j = 0; j < candidates.length; j++) {
      steps += 1;
      if (steps % 256 === 0) await yieldToEventLoop();
      if (i === j) continue;
      if (candidates[j].category.trim() !== category) continue;
      if (candidates[j].township.trim() !== township) continue;
      scored.push({ index: j, score: cosineSimilarity(candidates[i].vector, candidates[j].vector) });
    }
    scored.sort((left, right) => right.score - left.score || left.index - right.index);
    for (const neighbor of scored.slice(0, k)) {
      const left = Math.min(i, neighbor.index);
      const right = Math.max(i, neighbor.index);
      const key = `${left}:${right}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push([left, right]);
    }
  }
  return pairs;
}

/**
 * 和同步归并同一套并案条件。近邻对照旧全查。
 * 规则对只在指纹桶、同事件同镇街桶里查，每 512 对让出一次事件循环。
 */
export async function clusterFromStoredNeighborsYielding<T>(
  items: T[],
  read: (item: T, index: number) => IncidentLinkCandidate,
  neighborPairs?: Array<[number, number]>,
  yieldEvery = 512
): Promise<T[][]> {
  const candidates = items.map((item, index) => read(item, index));
  const pairs = neighborPairs ?? (await rankNeighborIndexesYielding(candidates));
  const neighborKeys = new Set(pairs.map(([left, right]) => `${Math.min(left, right)}:${Math.max(left, right)}`));
  const union = createUnion(items.length);
  const every = Math.max(1, yieldEvery);
  let steps = 0;
  const visit = (left: number, right: number) => {
    linkPair(candidates, neighborKeys, left, right, union.unite);
    steps += 1;
    return steps % every === 0;
  };

  for (const [left, right] of pairs) {
    if (visit(left, right)) await yieldToEventLoop();
  }

  const byFingerprint = new Map<string, number[]>();
  const byFamily = new Map<string, Map<string, number[]>>();
  for (let index = 0; index < candidates.length; index++) {
    const profile = candidates[index].profile;
    if (profile.fingerprint) {
      const list = byFingerprint.get(profile.fingerprint);
      if (list) list.push(index);
      else byFingerprint.set(profile.fingerprint, [index]);
    }
    if (profile.family) {
      let towns = byFamily.get(profile.family);
      if (!towns) {
        towns = new Map();
        byFamily.set(profile.family, towns);
      }
      const town = profile.township || "";
      const list = towns.get(town);
      if (list) list.push(index);
      else towns.set(town, [index]);
    }
    if ((index + 1) % 2000 === 0) await yieldToEventLoop();
  }

  const visitAllPairs = async (indexes: number[]) => {
    for (let a = 0; a < indexes.length; a++) {
      for (let b = a + 1; b < indexes.length; b++) {
        if (!ruleCouldMatch(candidates[indexes[a]].profile, candidates[indexes[b]].profile)) continue;
        if (visit(indexes[a], indexes[b])) await yieldToEventLoop();
      }
    }
  };

  for (const indexes of byFingerprint.values()) {
    if (indexes.length >= 2) await visitAllPairs(indexes);
  }
  for (const towns of byFamily.values()) {
    const empty = towns.get("") || [];
    for (const [town, indexes] of towns) {
      if (indexes.length >= 2) await visitAllPairs(indexes);
      if (!town || empty.length === 0) continue;
      for (const left of empty) {
        for (const right of indexes) {
          if (!ruleCouldMatch(candidates[left].profile, candidates[right].profile)) continue;
          if (visit(left, right)) await yieldToEventLoop();
        }
      }
    }
  }

  return groupsFromParent(items, union.parent);
}
