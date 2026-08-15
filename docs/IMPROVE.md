# Civic UI landing log

Work branch: `feat/civic-ui-landing`  
Reference: `/Users/FireTable/Downloads/frontend/`  
Rule: pages read persisted or aggregated data. No `Math.random` trends, no `log10(count)` fake confidence, no hardcoded 北滘 +186% insight as live copy.

## 2026-08-15 — start

- Created `feat/civic-ui-landing` from `main`.
- Plan: extend `tickets`/`themes` (no duplicate workorders/clusters tables), persist mode / first-last / confidence / handling / features / radar, add `diverge`, project APIs, rebuild six Next routes with design tokens.
- Verification this step: `git branch --show-current` → `feat/civic-ui-landing`.

## 2026-08-15 — schema + cluster persist

- Added ticket columns: `source_category`, `urgency`, `address`, `confidence`, `primary_theme_id`.
- Added theme columns: `pattern_type`, `ai_confidence`, `first_at`/`last_at`, handling fields, `features_json`/`radar_json`, `trend_pct`.
- Official generate: `db/migrations/0005_civic_ui_fields.sql` (after fixing 0003/0004 snapshot `prevId` collision so drizzle-kit could run).
- Verification: drizzle-kit generate succeeded; SQL lists the new columns.

## 2026-08-15 — diverge + metrics

- `inferPatternType`: ≥2 AI categories → `DIVERGE`; few callers → `INDIVIDUAL_REPEAT`; else gathering.
- Location clustering now groups by place only (not place+category) so diverge is not split apart.
- `deriveThemeMetrics` writes features/radar/confidence/trend from tickets (no random).
- Cluster persist writes the new theme/ticket fields.
- Verification: `pnpm exec tsx scripts/verify-civic-map.ts` (mode mapping + DTO + overview sums).

## 2026-08-15 — APIs

- `GET /api/overview`, `/api/trends`, `/api/workorders` (paged), `/api/workorders/[id]`, `/api/clusters`, `/api/clusters/[id]`.
- Projection in `lib/civic-dto.ts` / `lib/civic-stats.ts`.
- Insights built from stored themes, not the design HTML copy.
- Verification: mapping script asserts region totals reconstruct input count; no 马龙村 string.

## 2026-08-15 — six routes + tokens

- Copied design `tokens.css` / `components.css` (brand `#1677FF`).
- Top nav: 工作面板 `/` · 工单中心 `/tickets` · 多频透视 `/multifreq` · 群组中心 `/themes` plus `/tickets/[id]` and `/themes/[id]`.
- Dashboard KPI/insights/trend/ranking/heatmap; list pages paginate via APIs.
- Verification: `tsc --noEmit` 0; `pnpm build` 0; `next start -p 3011` GET `/` `/tickets` `/themes` `/multifreq` all HTTP 200 and HTML contains the four nav labels.

---
