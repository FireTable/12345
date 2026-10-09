/**
 * 库存向量的近邻只是候选人。并案仍走 shouldLinkIncidents。
 * HNSW 在回填写行期间不建。
 */
import { incidentsMatch } from "./ticket-profile";
import {
  cosineSimilarity,
  shouldLinkIncidents,
  type IncidentLinkCandidate,
} from "./same-incident-cluster";

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

/** 近邻对里仍要过 shouldLinkIncidents。规则对得上的对，即使不在前 20，也保留。 */
export function clusterFromStoredNeighbors<T>(
  items: T[],
  read: (item: T, index: number) => IncidentLinkCandidate,
  neighborPairs?: Array<[number, number]>
): T[][] {
  const candidates = items.map((item, index) => read(item, index));
  const pairs = neighborPairs ?? rankNeighborIndexes(candidates);
  const neighborKeys = new Set(pairs.map(([left, right]) => `${Math.min(left, right)}:${Math.max(left, right)}`));
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
      const key = `${i}:${j}`;
      const rule = incidentsMatch(candidates[i].profile, candidates[j].profile);
      if (!neighborKeys.has(key) && !rule) continue;
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
  return [...buckets.values()].filter((group) => group.length >= 2).sort((left, right) => right.length - left.length);
}
