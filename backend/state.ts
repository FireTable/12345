import { Annotation, messagesStateReducer } from "@langchain/langgraph";
import type { BaseMessage } from "@langchain/core/messages";

export type RiskLevel = "HIGH" | "MEDIUM" | "LOW";
export type EntityType = "SUBJECT" | "LOCATION" | "EVENT_TYPE" | "CORE_DEMAND";

export interface ExtractedEntity {
  name: string;
  canonicalName: string;
  type: EntityType;
  confidence: number;
}

export interface ExtractedRelation {
  source: string;
  target: string;
  relation: string;
}

export interface RawTicket {
  id: string;
  ticketNo: string;
  createTime: string;
  citizenName: string;
  citizenPhone: string;
  district: string;
  subdistrict: string;
  content: string;
  channel: string;
  status: "PENDING" | "VERIFIED" | "DISPATCHED" | "RESOLVED";
}

export interface EnrichedTicket extends RawTicket {
  entities: ExtractedEntity[];
  relations: ExtractedRelation[];
  themes: string[];
  canonicalSubject: string;
  canonicalLocation: string;
  eventType: string;
  clusterId?: string;
  similarityScore?: number;
}

export interface MultiFrequencyTheme {
  id: string;
  title: string;
  canonicalSubject: string;
  canonicalLocation: string;
  eventType: string;
  category: string;
  riskLevel: RiskLevel;
  riskReason: string;
  ticketCount: number;
  timeSpanHours: number;
  firstOccurrence: string;
  lastOccurrence: string;
  aiSummary: string;
  recommendedAction: string;
  tickets: EnrichedTicket[];
  relatedSubjects: string[];
  relatedLocations: string[];
  status: "UNCHECKED" | "CHECKING" | "CONFIRMED" | "DISMISSED";
}

export interface GraphNode {
  id: string;
  name: string;
  type: "TICKET" | "SUBJECT" | "LOCATION" | "THEME";
  val: number;
  color?: string;
  riskLevel?: RiskLevel;
  ticketCount?: number;
  meta?: any;
}

export interface GraphLink {
  source: string;
  target: string;
  relation: string;
  value?: number;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export interface OverallStats {
  totalTickets: number;
  multiFrequencyTickets: number;
  multiFrequencyRate: number;
  themeCount: number;
  highRiskCount: number;
  mediumRiskCount: number;
  lowRiskCount: number;
  compressionRatio: number;
  topSubject: string;
  avgResponseTimeSavedHours: number;
}

/**
 * LangGraph State Shape for Ticket Radar
 */
export const TicketRadarStateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  rawTickets: Annotation<RawTicket[]>({
    reducer: (prev, next) => (next && next.length > 0 ? next : prev),
    default: () => [],
  }),
  enrichedTickets: Annotation<EnrichedTicket[]>({
    reducer: (prev, next) => (next && next.length > 0 ? next : prev),
    default: () => [],
  }),
  themes: Annotation<MultiFrequencyTheme[]>({
    reducer: (prev, next) => (next && next.length > 0 ? next : prev),
    default: () => [],
  }),
  stats: Annotation<OverallStats>({
    reducer: (prev, next) => ({ ...prev, ...next }),
    default: () => ({
      totalTickets: 0,
      multiFrequencyTickets: 0,
      multiFrequencyRate: 0,
      themeCount: 0,
      highRiskCount: 0,
      mediumRiskCount: 0,
      lowRiskCount: 0,
      compressionRatio: 0,
      topSubject: "",
      avgResponseTimeSavedHours: 0,
    }),
  }),
  graphData: Annotation<GraphData>({
    reducer: (prev, next) => (next && next.nodes?.length > 0 ? next : prev),
    default: () => ({ nodes: [], links: [] }),
  }),
  status: Annotation<"idle" | "extracting" | "clustering" | "completed" | "failed">({
    reducer: (prev, next) => next || prev,
    default: () => "idle",
  }),
});

export type TicketRadarState = typeof TicketRadarStateAnnotation.State;
