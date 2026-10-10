export interface CockpitTicket {
  id: string;
  ticketNo: string;
  title?: string;
  summarizeTitle?: string;
  createTime: string;
  citizenName?: string;
  district?: string;
  subdistrict?: string;
  channel?: string;
  status: string;
  content: string;
  category?: string;
  isUrgent?: boolean;
}

export interface CockpitTownshipStat {
  name: string;
  count: number;
  sharePct: number;
  rank: number;
  highlight?: boolean;
}

export interface CockpitAlertItem {
  id: string;
  title: string;
  category: string;
  subdistrict?: string;
  urgency: "HIGH" | "MEDIUM" | "LOW";
  createTime: string;
  status: string;
  desc?: string;
}

export interface CockpitInsightItem {
  id: string;
  title: string;
  category: string;
  ticketCount: number;
  trendPct?: number;
  advice?: string;
  canonicalSubject?: string;
  canonicalLocation?: string;
}

export interface CockpitKpiData {
  todayCount: number;
  todayGrowthPct: number;
  totalTickets: number;
  dailyAverage: number;
  resolutionRatePct: number;
  multifreqCount: number;
  clusterCount: number;
  urgentAlertCount: number;
}
