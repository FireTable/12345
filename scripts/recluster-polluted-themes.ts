import nextEnvPkg from "@next/env";
import { differenceInHours, isValid, parse, parseISO } from "date-fns";
import { and, eq, inArray, sql as drizzleSql } from "drizzle-orm";
import { getRegionDb } from "../db/client";
import { themesTable, ticketsTable, ticketThemesTable } from "../db/schema";
import {
  getRegionVocabulary,
  legalTownshipName,
  canonicalizeCategory,
  type RegionVocabulary,
} from "../lib/vocabulary";
import { HANDLING_STATUS } from "../lib/civic-dto";
import { invalidateCivicAggregates } from "../lib/civic-cache";
import { loadStoredNeighborPairs } from "../lib/ticket-embeddings";
import { ensureTicketThemesVerificationColumns } from "../lib/ticket-themes-schema";
import { isGenericOrPlaceholderSubject, RULES } from "../backend/rules";
import { incidentsMatch, profileTicket, type IncidentProfile } from "../backend/ticket-profile";
import { chooseThemeAnchor } from "../backend/same-incident-cluster";
import { clusterFromStoredNeighborsYielding } from "../backend/embed-neighbors";
import { validateAndFilterThemes } from "../backend/node/cluster-validator";
import { markFakeClosures } from "../backend/node/fake-closure";
import { deriveRiskLevel, scanNegativeSentiment } from "../backend/node/risk-rules";
import {
  cadenceLabel,
  civicModeFromPattern,
  deriveThemeMetrics,
  describeCadence,
  inferPatternType,
} from "../backend/theme-metrics";
import type { EnrichedTicket, MultiFrequencyTheme, RiskLevel } from "../backend/state";
import { buildThemePersistRow } from "../lib/civic-persist";

const { loadEnvConfig } = (nextEnvPkg as any).default || nextEnvPkg;
if (loadEnvConfig) loadEnvConfig(process.cwd());

const WILDCARD_CATEGORIES = new Set(["", "综合民生", "其他", "未分类"]);

interface CliOptions {
  regions: string[];
  apply: boolean;
  dryRun: boolean;
  limit?: number;
}

function parseArgs(argv: string[]): CliOptions {
  let regions = ["gz_tianhe", "fs_shunde"];
  let apply = false;
  let limit: number | undefined;

  for (const arg of argv) {
    if (arg.startsWith("--regions=")) {
      regions = arg
        .slice("--regions=".length)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (arg.startsWith("--region=")) {
      regions = arg
        .slice("--region=".length)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (arg === "--apply") {
      apply = true;
    } else if (arg === "--dry-run") {
      apply = false;
    } else if (arg.startsWith("--limit=")) {
      const n = Number(arg.slice("--limit=".length));
      if (Number.isFinite(n) && n > 0) limit = Math.round(n);
    }
  }

  return { regions, apply, dryRun: !apply, limit };
}

function safeParseDate(dateStr?: string | null): Date {
  if (!dateStr) return new Date();
  const d1 = parse(dateStr, "yyyy-MM-dd HH:mm:ss", new Date());
  if (isValid(d1)) return d1;
  const d2 = parseISO(dateStr);
  if (isValid(d2)) return d2;
  const d3 = new Date(dateStr);
  return isValid(d3) ? d3 : new Date();
}

function formatCreateTime(val: Date | string | null | undefined): string {
  if (!val) return new Date().toISOString();
  const d = val instanceof Date ? val : new Date(val);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function majority(values: Array<string | null | undefined>): string | null {
  const counts = new Map<string, number>();
  for (const value of values) {
    const text = (value || "").trim();
    if (!text) continue;
    counts.set(text, (counts.get(text) || 0) + 1);
  }
  let best: string | null = null;
  let n = 0;
  for (const [value, count] of counts) {
    if (count > n) {
      best = value;
      n = count;
    }
  }
  return best;
}

function cleanPlaceholderText(raw?: string | null): string {
  const text = (raw || "").trim();
  if (!text) return "";
  if (isGenericOrPlaceholderSubject(text)) return "";
  return text;
}

function stripLocationPlaceholders(raw?: string | null): string {
  const text = (raw || "").trim();
  if (!text) return "";
  return text
    .replace(
      /(?:某建设工程工地|某在建[\u4e00-\u9fffA-Za-z0-9]*工地|某号一楼临街[\u4e00-\u9fffA-Za-z0-9]*|某号[\u4e00-\u9fffA-Za-z0-9]*)$/g,
      ""
    )
    .replace(/[·\s]+$/g, "")
    .trim();
}

function leadDepartmentForCategory(category: string): string {
  if (category.includes("劳动") || category.includes("社保")) return "区人社局/区住建局";
  if (category.includes("生态") || category.includes("环保")) return "区生态环境分局/区住建局";
  if (category.includes("交通")) return "区交警大队/区交通运输局";
  if (category.includes("安全") || category.includes("消防")) return "区应急管理局/区消防救援大队";
  if (category.includes("市场")) return "区市场监管局";
  if (category.includes("城市")) return "区城市管理和综合执法局";
  return "所属行业主管部门";
}

function normalizeConcreteCategory(raw: string | null | undefined): string | null {
  const trimmed = (raw || "").trim();
  if (!trimmed || WILDCARD_CATEGORIES.has(trimmed)) return null;
  const norm = canonicalizeCategory(trimmed) || trimmed;
  if (!norm || WILDCARD_CATEGORIES.has(norm)) return null;
  return norm;
}

function hasPlaceholderTitle(title: string): boolean {
  if (!title) return false;
  return /某(?:号|工地|建设工程|在建|建筑|公司|单位|餐厅|湘菜馆|餐饮|商铺|项目|路段|小区|住宅小区|网络科技|数字传媒|智能信息|轮滑|瑜伽|少儿)/.test(
    title
  );
}

interface LoadedMemberRow {
  ticketId: string;
  ticketNo: string;
  title: string | null;
  summarizeTitle: string | null;
  content: string;
  district: string | null;
  subdistrict: string | null;
  sourceCategory: string | null;
  urgency: string | null;
  slaHours: number | null;
  stabilityRisk: boolean | null;
  canonicalSubject: string | null;
  eventType: string | null;
  address: string | null;
  confidence: number | null;
  status: string | null;
  createTime: Date | null;
  closedAt: Date | null;
  closureStatus: string | null;
  isFakeClosure: boolean | null;
  humanVerified: boolean;
  verifiedBy: string | null;
  verifiedAt: Date | null;
}

async function reclusterRegion(regionId: string, opts: CliOptions) {
  console.log(`\n==================== [${regionId}] (${opts.apply ? "APPLY" : "DRY-RUN"}) ====================`);
  const { db } = await getRegionDb(regionId);
  await ensureTicketThemesVerificationColumns(db, regionId);
  const vocab: RegionVocabulary = await getRegionVocabulary(regionId);

  const pendingThemes = await db
    .select({
      id: themesTable.id,
      title: themesTable.title,
      category: themesTable.category,
      canonicalSubject: themesTable.canonicalSubject,
      canonicalLocation: themesTable.canonicalLocation,
      ticketCount: themesTable.ticketCount,
      handlingStatus: themesTable.handlingStatus,
    })
    .from(themesTable)
    .where(eq(themesTable.handlingStatus, "PENDING"));

  const allThemeIdRows = await db.select({ id: themesTable.id }).from(themesTable);
  let maxSerial = 0;
  for (const row of allThemeIdRows) {
    const match = /^THEME-(\d+)$/i.exec(row.id);
    if (match) {
      const n = Number(match[1]);
      if (Number.isFinite(n) && n > maxSerial) maxSerial = n;
    }
  }
  let nextSerial = maxSerial + 1;

  // Find mixed-category PENDING themes via SQL aggregation
  const mixedCatRows = await db.execute(drizzleSql`
    SELECT tt.theme_id
    FROM ticket_themes tt
    JOIN themes th ON th.id = tt.theme_id
    JOIN tickets t ON t.id = tt.ticket_id
    WHERE th.handling_status = 'PENDING'
      AND NULLIF(TRIM(t.source_category), '') IS NOT NULL
      AND TRIM(t.source_category) NOT IN ('综合民生', '其他', '未分类')
    GROUP BY tt.theme_id
    HAVING count(DISTINCT TRIM(t.source_category)) > 1
  `);
  const mixedCatSet = new Set<string>(
    ((mixedCatRows as any).rows || mixedCatRows || []).map((r: any) => String(r.theme_id))
  );

  // Also detect any PENDING theme whose members have placeholder subjects or multiple distinct WAGE_ARREARS sites
  const candidatePollutedIds = new Set<string>(mixedCatSet);
  for (const theme of pendingThemes) {
    if (
      isGenericOrPlaceholderSubject(theme.canonicalSubject || "") ||
      hasPlaceholderTitle(theme.title || "") ||
      theme.category === "劳动社保" ||
      (theme.canonicalSubject || "") === "工程结算纠纷致农民工工资拖欠"
    ) {
      candidatePollutedIds.add(theme.id);
    }
  }

  // Load candidate theme IDs deterministically (largest first so THEME-1 / THEME-10 / THEME-35 appear early)
  const themeById = new Map(pendingThemes.map((t) => [t.id, t]));
  const orderedCandidateIds = Array.from(candidatePollutedIds)
    .filter((id) => themeById.has(id))
    .sort((a, b) => (themeById.get(b)?.ticketCount || 0) - (themeById.get(a)?.ticketCount || 0));

  const targetIds = opts.limit ? orderedCandidateIds.slice(0, opts.limit) : orderedCandidateIds;
  console.log(
    `[${regionId}] PENDING themes=${pendingThemes.length}, mixed-category=${mixedCatSet.size}, candidate queue=${targetIds.length}, nextSerial=${nextSerial}`
  );

  if (targetIds.length === 0) {
    console.log(`[${regionId}] Nothing to recluster.`);
    return;
  }

  console.log(`[${regionId}] Loading stored pgvector neighbor pairs once for region...`);
  const t0 = Date.now();
  const regionPairs = (await loadStoredNeighborPairs(regionId)) || [];
  const adjMap = new Map<string, Set<string>>();
  for (const [a, b] of regionPairs) {
    let setA = adjMap.get(a);
    if (!setA) {
      setA = new Set();
      adjMap.set(a, setA);
    }
    setA.add(b);
    let setB = adjMap.get(b);
    if (!setB) {
      setB = new Set();
      adjMap.set(b, setB);
    }
    setB.add(a);
  }
  console.log(`[${regionId}] Loaded ${regionPairs.length} neighbor pairs in ${Date.now() - t0}ms`);

  let inspected = 0;
  let splitCount = 0;
  let cleanedInPlace = 0;
  let deletedSingletonOnly = 0;
  let newSubThemesCreated = 0;
  let unlinkedSingletons = 0;

  const CHUNK_LOAD = 25;
  for (let start = 0; start < targetIds.length; start += CHUNK_LOAD) {
    const batchIds = targetIds.slice(start, start + CHUNK_LOAD);
    const memberRows = await db
      .select({
        themeId: ticketThemesTable.themeId,
        ticketId: ticketsTable.id,
        ticketNo: ticketsTable.ticketNo,
        title: ticketsTable.title,
        summarizeTitle: ticketsTable.summarizeTitle,
        content: ticketsTable.content,
        district: ticketsTable.district,
        subdistrict: ticketsTable.subdistrict,
        sourceCategory: ticketsTable.sourceCategory,
        urgency: ticketsTable.urgency,
        slaHours: ticketsTable.slaHours,
        stabilityRisk: ticketsTable.stabilityRisk,
        canonicalSubject: ticketsTable.canonicalSubject,
        eventType: ticketsTable.eventType,
        address: ticketsTable.address,
        confidence: ticketsTable.confidence,
        status: ticketsTable.status,
        createTime: ticketsTable.createTime,
        closedAt: ticketsTable.closedAt,
        closureStatus: ticketsTable.closureStatus,
        isFakeClosure: ticketsTable.isFakeClosure,
        humanVerified: ticketThemesTable.humanVerified,
        verifiedBy: ticketThemesTable.verifiedBy,
        verifiedAt: ticketThemesTable.verifiedAt,
      })
      .from(ticketThemesTable)
      .innerJoin(ticketsTable, eq(ticketsTable.id, ticketThemesTable.ticketId))
      .where(inArray(ticketThemesTable.themeId, batchIds));

    const membersByTheme = new Map<string, LoadedMemberRow[]>();
    for (const row of memberRows) {
      const list = membersByTheme.get(row.themeId) || [];
      list.push(row);
      membersByTheme.set(row.themeId, list);
    }

    for (const oldThemeId of batchIds) {
      inspected += 1;
      const origTheme = themeById.get(oldThemeId)!;
      const rows = membersByTheme.get(oldThemeId) || [];
      if (rows.length === 0) continue;

      // Verify this theme actually has pollution (mixed categories, placeholder anchor/title, or multi-site WAGE_ARREARS)
      const catSet = new Set<string>();
      const wageProfiles: IncidentProfile[] = [];
      let hasPlaceholder =
        isGenericOrPlaceholderSubject(origTheme.canonicalSubject || "") ||
        hasPlaceholderTitle(origTheme.title || "");

      for (const r of rows) {
        const normCat = normalizeConcreteCategory(r.sourceCategory);
        if (normCat) catSet.add(normCat);
        if (isGenericOrPlaceholderSubject(r.canonicalSubject || "")) hasPlaceholder = true;
        const prof = profileTicket(
          { title: r.title || "", content: r.content, subdistrict: r.subdistrict || "" },
          vocab.townships
        );
        if (prof.family === "WAGE_ARREARS") {
          wageProfiles.push(prof);
        }
      }
      let hasConflictingWagePlaces = false;
      if (wageProfiles.length >= 2) {
        const base = wageProfiles[0];
        for (let i = 1; i < wageProfiles.length; i++) {
          if (!incidentsMatch(base, wageProfiles[i])) {
            hasConflictingWagePlaces = true;
            break;
          }
        }
      }

      if (catSet.size <= 1 && !hasPlaceholder && !hasConflictingWagePlaces) {
        continue;
      }

      // Build EnrichedTicket objects with placeholder canonicalSubject sanitized
      const enrichedTickets: EnrichedTicket[] = rows.map((r) => {
        const cleanSubject = cleanPlaceholderText(r.canonicalSubject);
        const cleanAddr = stripLocationPlaceholders(r.address || "") || r.address || "";
        return {
          id: r.ticketId,
          ticketNo: r.ticketNo,
          title: r.title || r.summarizeTitle || "市民诉求",
          summarizeTitle: r.summarizeTitle || r.title || "市民诉求",
          content: r.content,
          citizenName: "",
          citizenPhone: "",
          channel: "市民服务热线",
          status: "PENDING",
          entities: [],
          relations: [],
          subdistrict: r.subdistrict || "",
          district: r.district || "",
          sourceCategory: r.sourceCategory || "",
          urgency: (r.urgency as "URGENT" | "NORMAL") || "NORMAL",
          slaHours: r.slaHours ?? 72,
          stabilityRisk: Boolean(r.stabilityRisk),
          canonicalSubject: cleanSubject,
          eventType: r.eventType || "民生诉求",
          canonicalLocation: cleanAddr,
          address: r.address || "",
          confidence: r.confidence ?? 55,
          createTime: formatCreateTime(r.createTime),
          closedAt: r.closedAt ? formatCreateTime(r.closedAt) : undefined,
          closureStatus:
            r.closureStatus === "RESOLVED" || r.closureStatus === "REOPENED" ? r.closureStatus : undefined,
          isFakeClosure: Boolean(r.isFakeClosure),
          primaryThemeId: undefined,
          themes: [],
        };
      });

      const prepared = enrichedTickets.map((ticket) => ({
        ticket,
        candidate: {
          profile: profileTicket(
            { title: ticket.title, content: ticket.content, subdistrict: ticket.subdistrict },
            vocab.townships
          ),
          category: ticket.sourceCategory || "",
          township:
            ticket.subdistrict ||
            legalTownshipName(`${ticket.canonicalLocation || ""}\n${ticket.content || ""}`, vocab) ||
            "",
          placeEvidence: [ticket.canonicalLocation, ticket.summarizeTitle, ticket.content].filter(Boolean).join("\n"),
          subject: ticket.canonicalSubject || "",
          vector: [] as number[],
        },
      }));

      // Map stored neighbor pairs restricted to this theme's members
      const indexById = new Map(enrichedTickets.map((t, idx) => [t.id, idx]));
      const localPairs: Array<[number, number]> = [];
      const seenPairKeys = new Set<string>();
      for (let i = 0; i < enrichedTickets.length; i++) {
        const neighbors = adjMap.get(enrichedTickets[i].id);
        if (!neighbors) continue;
        for (const nId of neighbors) {
          const j = indexById.get(nId);
          if (j == null || j <= i) continue;
          const k = `${i}|${j}`;
          if (!seenPairKeys.has(k)) {
            seenPairKeys.add(k);
            localPairs.push([i, j]);
          }
        }
      }

      const groups = await clusterFromStoredNeighborsYielding(
        prepared,
        (row) => row.candidate,
        localPairs.length > 0 ? localPairs : undefined
      );

      // Build MultiFrequencyTheme objects for each group
      const builtThemes: MultiFrequencyTheme[] = [];
      for (const grp of groups) {
        const members = grp
          .map((g) => g.ticket)
          .sort((a, b) => safeParseDate(a.createTime).getTime() - safeParseDate(b.createTime).getTime());
        const firstTime = members[0].createTime;
        const lastTime = members[members.length - 1].createTime;
        const timeSpanHours = Math.max(
          1,
          differenceInHours(safeParseDate(lastTime), safeParseDate(firstTime))
        );
        const tempId = builtThemes.length === 0 ? oldThemeId : `THEME-${nextSerial++}`;
        const eventType = majority(members.map((m) => m.eventType)) || "同类诉求";
        const township = majority(members.map((m) => m.subdistrict)) || "";
        const category = majority(members.map((m) => normalizeConcreteCategory(m.sourceCategory))) || majority(members.map((m) => m.sourceCategory)) || "";
        const profiledPlaces = members.map((m) => {
          const prof = profileTicket(
            { title: m.title, content: m.content, subdistrict: m.subdistrict },
            vocab.townships
          );
          return prof.place || stripLocationPlaceholders(m.canonicalLocation) || "";
        });
        const place = majority(profiledPlaces);
        const anchor = chooseThemeAnchor({
          subjects: members.map((m) => m.canonicalSubject || ""),
          placeEvidence: members.map((m) =>
            [m.canonicalLocation, m.summarizeTitle, m.content].filter(Boolean).join("\n")
          ),
          eventType,
        });
        const location = place
          ? [township && place.includes(township) ? "" : township, place].filter(Boolean).join("")
          : [township, anchor === eventType ? "" : anchor].filter(Boolean).join("") || anchor || "本地辖区";
        const titleParts =
          anchor === eventType
            ? [township, place && place !== township ? place : "", eventType]
            : [township, anchor, eventType];
        const title = Array.from(new Set(titleParts.map((s) => s.trim()).filter(Boolean))).join(" · ") || eventType;

        members.forEach((t) => {
          t.clusterId = tempId;
        });

        const { reopenCount, reopenTicketIds } = markFakeClosures(members);
        const patternType = inferPatternType(members);
        const hitNegative = scanNegativeSentiment(members);
        const riskLevel = deriveRiskLevel({
          ticketCount: members.length,
          patternType,
          hitNegative,
          reopenCount,
        });
        const cadence = describeCadence(members.map((m) => m.createTime));
        const metrics = deriveThemeMetrics({
          eventType,
          canonicalLocation: location,
          tickets: members,
          patternType,
        });
        const distinctSubjects = Array.from(
          new Set(members.map((t) => cleanPlaceholderText(t.canonicalSubject)).filter(Boolean))
        );
        const distinctLocations = Array.from(
          new Set(members.map((t) => stripLocationPlaceholders(t.canonicalLocation)).filter(Boolean))
        );
        const dept = leadDepartmentForCategory(category);
        const aiSummary = `围绕「${location}」汇聚 ${members.length} 件「${category || eventType}」同源诉求，主要反映${eventType}问题，已按同事件与同主体规则聚合校验。`;
        const recommendedAction = `牵头部门：${township ? `${township}办/` : ""}${dept}；响应时限：${
          riskLevel === "HIGH" ? "24小时内" : "2个工作日内"
        }；办理路径：1. 核查「${location}」现场与具体涉事责任主体；2. 按单一业务分类协同处置并反馈整改结果。`;

        builtThemes.push({
          id: tempId,
          title,
          canonicalSubject: anchor,
          canonicalLocation: location,
          eventType,
          category,
          riskLevel,
          patternType,
          civicMode: civicModeFromPattern(patternType),
          riskReason:
            reopenCount > 0
              ? `办结${RULES.fakeClosure.windowDays}天内再次诉求（${reopenCount}次，${cadenceLabel(cadence)}）`
              : `同一事件重复反映（${members.length}件，${cadenceLabel(cadence)}）`,
          ticketCount: members.length,
          timeSpanHours,
          firstOccurrence: firstTime,
          lastOccurrence: lastTime,
          aiSummary,
          recommendedAction,
          tickets: members,
          relatedSubjects: distinctSubjects.length > 0 ? distinctSubjects : [anchor],
          relatedLocations: distinctLocations.length > 0 ? distinctLocations : [location],
          status: "UNCHECKED",
          reopenCount,
          reopenTicketIds,
          aiConfidence: metrics.aiConfidence,
          features: metrics.features,
          radar: metrics.radar,
          trendPct: metrics.trendPct,
          handlingStatus: HANDLING_STATUS.PENDING,
          handlingProgress: 0,
        });
      }

      const validThemes = validateAndFilterThemes(builtThemes, enrichedTickets, vocab);
      const riskOrder: Record<RiskLevel, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
      validThemes.sort((a, b) => {
        if (b.ticketCount !== a.ticketCount) return b.ticketCount - a.ticketCount;
        return riskOrder[a.riskLevel] - riskOrder[b.riskLevel];
      });

      // Re-assign IDs: largest sub-cluster keeps oldThemeId so bookmarked/demo URLs remain intact
      if (validThemes.length > 0) {
        validThemes[0].id = oldThemeId;
        validThemes[0].tickets.forEach((t) => {
          t.clusterId = oldThemeId;
        });
        for (let idx = 1; idx < validThemes.length; idx++) {
          if (validThemes[idx].id === oldThemeId) {
            validThemes[idx].id = `THEME-${nextSerial++}`;
            validThemes[idx].tickets.forEach((t) => {
              t.clusterId = validThemes[idx].id;
            });
          }
        }
      }

      const assignedIds = new Set(validThemes.flatMap((t) => t.tickets.map((m) => m.id)));
      unlinkedSingletons += rows.length - assignedIds.size;

      if (validThemes.length === 0) {
        deletedSingletonOnly += 1;
      } else if (validThemes.length === 1) {
        cleanedInPlace += 1;
      } else {
        splitCount += 1;
        newSubThemesCreated += validThemes.length - 1;
      }

      if (
        oldThemeId === "THEME-1" ||
        oldThemeId === "THEME-9" ||
        oldThemeId === "THEME-10" ||
        oldThemeId === "THEME-35" ||
        oldThemeId === "THEME-4"
      ) {
        console.log(
          `  [Sample ${oldThemeId}] old("${origTheme.title}", ${origTheme.ticketCount}件, cats=${catSet.size}) -> ${validThemes.length} pure theme(s), ${rows.length - assignedIds.size} singletons:`
        );
        for (const sub of validThemes.slice(0, 6)) {
          console.log(`     - ${sub.id}: "${sub.title}" [${sub.category}] (${sub.ticketCount}件)`);
        }
        if (validThemes.length > 6) {
          console.log(`     ... +${validThemes.length - 6} more sub-themes`);
        }
      }

      if (!opts.apply) continue;

      const oldVerifyMap = new Map<string, LoadedMemberRow>();
      for (const r of rows) {
        if (r.humanVerified) oldVerifyMap.set(r.ticketId, r);
      }

      await db.transaction(async (tx) => {
        // 1. Unlink all old members & sanitize placeholder canonical_subject on those tickets
        await tx.delete(ticketThemesTable).where(eq(ticketThemesTable.themeId, oldThemeId));
        const allOldTicketIds = rows.map((r) => r.ticketId);
        for (let i = 0; i < allOldTicketIds.length; i += 1000) {
          const chunk = allOldTicketIds.slice(i, i + 1000);
          await tx
            .update(ticketsTable)
            .set({ primaryThemeId: null })
            .where(and(inArray(ticketsTable.id, chunk), eq(ticketsTable.primaryThemeId, oldThemeId)));
        }

        const placeholderTicketIds = rows
          .filter((r) => isGenericOrPlaceholderSubject(r.canonicalSubject || ""))
          .map((r) => r.ticketId);
        for (let i = 0; i < placeholderTicketIds.length; i += 1000) {
          const chunk = placeholderTicketIds.slice(i, i + 1000);
          await tx
            .update(ticketsTable)
            .set({ canonicalSubject: "" })
            .where(inArray(ticketsTable.id, chunk));
        }

        if (validThemes.length === 0) {
          await tx.delete(themesTable).where(eq(themesTable.id, oldThemeId));
          return;
        }

        // 2. Update largest sub-theme on oldThemeId, insert any additional split themes
        const primaryRow = buildThemePersistRow(validThemes[0]);
        await tx
          .update(themesTable)
          .set({
            title: primaryRow.title,
            canonicalSubject: primaryRow.canonicalSubject,
            canonicalLocation: primaryRow.canonicalLocation,
            eventType: primaryRow.eventType,
            category: primaryRow.category,
            riskLevel: primaryRow.riskLevel,
            riskReason: primaryRow.riskReason,
            ticketCount: primaryRow.ticketCount,
            timeSpanHours: primaryRow.timeSpanHours,
            aiSummary: primaryRow.aiSummary,
            recommendedAction: primaryRow.recommendedAction,
            patternType: primaryRow.patternType,
            civicMode: primaryRow.civicMode,
            aiConfidence: primaryRow.aiConfidence,
            firstAt: primaryRow.firstAt,
            lastAt: primaryRow.lastAt,
            featuresJson: primaryRow.featuresJson,
            radarJson: primaryRow.radarJson,
            trendPct: primaryRow.trendPct,
          })
          .where(eq(themesTable.id, oldThemeId));

        if (validThemes.length > 1) {
          const extraRows = validThemes.slice(1).map(buildThemePersistRow);
          for (let i = 0; i < extraRows.length; i += 200) {
            await tx.insert(themesTable).values(extraRows.slice(i, i + 200)).onConflictDoNothing({ target: themesTable.id });
          }
        }

        // 3. Re-insert ticket_themes & update primary_theme_id
        const newMappings: Array<{
          ticketId: string;
          themeId: string;
          humanVerified: boolean;
          verifiedBy: string | null;
          verifiedAt: Date | null;
        }> = [];
        for (const sub of validThemes) {
          const memberTicketIds: string[] = [];
          for (const t of sub.tickets) {
            memberTicketIds.push(t.id);
            const prevVerify = oldVerifyMap.get(t.id);
            newMappings.push({
              ticketId: t.id,
              themeId: sub.id,
              humanVerified: Boolean(prevVerify?.humanVerified),
              verifiedBy: prevVerify?.verifiedBy ?? null,
              verifiedAt: prevVerify?.verifiedAt ?? null,
            });
          }
          for (let i = 0; i < memberTicketIds.length; i += 1000) {
            await tx
              .update(ticketsTable)
              .set({ primaryThemeId: sub.id })
              .where(inArray(ticketsTable.id, memberTicketIds.slice(i, i + 1000)));
          }
        }

        for (let i = 0; i < newMappings.length; i += 500) {
          await tx.insert(ticketThemesTable).values(newMappings.slice(i, i + 500)).onConflictDoNothing();
        }
      });
    }
  }

  if (opts.apply) {
    invalidateCivicAggregates(regionId);
  }

  console.log(
    `[${regionId}] Summary (${opts.apply ? "APPLIED" : "DRY-RUN"}): inspected=${inspected}, split=${splitCount}, cleanedInPlace=${cleanedInPlace}, deletedAllSingletons=${deletedSingletonOnly}, newSubThemes=${newSubThemesCreated}, unlinkedSingletons=${unlinkedSingletons}`
  );

  if (opts.apply) {
    const remainingMixed = await db.execute(drizzleSql`
      SELECT count(*) AS cnt FROM (
        SELECT tt.theme_id
        FROM ticket_themes tt
        JOIN themes th ON th.id = tt.theme_id
        JOIN tickets t ON t.id = tt.ticket_id
        WHERE th.handling_status = 'PENDING'
          AND NULLIF(TRIM(t.source_category), '') IS NOT NULL
          AND TRIM(t.source_category) NOT IN ('综合民生', '其他', '未分类')
        GROUP BY tt.theme_id
        HAVING count(DISTINCT TRIM(t.source_category)) > 1
      ) sub
    `);
    const cnt = ((remainingMixed as any).rows || remainingMixed || [])[0]?.cnt ?? "?";
    console.log(`[${regionId}] Remaining PENDING mixed-category themes: ${cnt}`);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  for (const regionId of opts.regions) {
    await reclusterRegion(regionId, opts);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("[recluster-polluted-themes] Failed:", err);
  process.exit(1);
});
