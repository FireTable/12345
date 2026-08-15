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
  createTime: string; // ISO or YYYY-MM-DD HH:mm:ss
  citizenName: string; // Anonymized, e.g. "张**", "李**"
  citizenPhone: string; // Anonymized, e.g. "138****1234"
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
  verificationNote?: string;
}

export interface MultiFrequencyTheme {
  id: string;
  title: string; // e.g. "XX小区夜间违规施工扰民"
  canonicalSubject: string;
  canonicalLocation: string;
  eventType: string;
  category: string; // e.g. "环保与噪音", "市容城管", "市政公用", "物业维权"
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
  val: number; // size in force graph
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
  multiFrequencyRate: number; // percentage
  themeCount: number;
  highRiskCount: number;
  mediumRiskCount: number;
  lowRiskCount: number;
  compressionRatio: number; // e.g. 100 -> 12 = 88% compression
  topSubject: string;
  avgResponseTimeSavedHours: number;
}
