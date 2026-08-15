"use client";

import React, { createContext, useCallback, useContext, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { UploadDialog } from "@/app/_components/dashboard/upload-dialog";
import { LightCopilot } from "@/app/_components/copilot/light-copilot";
import type { MultiFrequencyTheme, OverallStats } from "@/backend/state";

const emptyStats: OverallStats = {
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
};

type CivicWorkflow = {
  analyzing: boolean;
  openUpload: () => void;
  openCopilot: () => void;
  runCluster: () => void;
};

const CivicWorkflowContext = createContext<CivicWorkflow | null>(null);

export function useCivicWorkflow() {
  const ctx = useContext(CivicWorkflowContext);
  if (!ctx) throw new Error("useCivicWorkflow must be used under CivicWorkflowProvider");
  return ctx;
}

export function CivicWorkflowProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [clusterOnly, setClusterOnly] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [themes, setThemes] = useState<MultiFrequencyTheme[]>([]);
  const [stats, setStats] = useState<OverallStats>(emptyStats);

  const refreshPages = useCallback(() => {
    router.refresh();
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("civic-data-refresh"));
    }
  }, [router]);

  const openUpload = useCallback(() => {
    setClusterOnly(false);
    setUploadOpen(true);
  }, []);

  const runCluster = useCallback(() => {
    setClusterOnly(true);
    setUploadOpen(true);
  }, []);

  return (
    <CivicWorkflowContext.Provider
      value={{
        analyzing,
        openUpload,
        openCopilot: () => setCopilotOpen(true),
        runCluster,
      }}
    >
      {children}
      <UploadDialog
        isOpen={uploadOpen}
        autoStartCluster={clusterOnly}
        onClusteringChange={setAnalyzing}
        onClose={() => {
          if (analyzing) return;
          setUploadOpen(false);
          setClusterOnly(false);
        }}
        onDatabaseUpdated={refreshPages}
        onUploadSuccess={(data) => {
          setThemes(data.themes || []);
          if (data.stats) setStats({ ...emptyStats, ...data.stats });
          toast.success(clusterOnly ? "研判完成" : "入库并研判完成");
          setAnalyzing(false);
          setUploadOpen(false);
          setClusterOnly(false);
          refreshPages();
        }}
      />
      <LightCopilot
        isOpen={copilotOpen}
        onClose={() => setCopilotOpen(false)}
        themes={themes}
        stats={stats}
        onSelectTheme={(t) => {
          setCopilotOpen(false);
          router.push(`/themes/${t.id}`);
        }}
      />
    </CivicWorkflowContext.Provider>
  );
}
