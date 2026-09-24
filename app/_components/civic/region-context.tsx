"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { toast } from "sonner";

export interface RegionInfo {
  id: string;
  name: string;
  city: string;
  province: string;
  schemaName: string;
  svgMapPath?: string | null;
  isDefault?: boolean;
  description?: string | null;
  ticketCount?: number;
  themeCount?: number;
  vocabCount?: number;
}

interface RegionContextValue {
  activeRegion: RegionInfo | null;
  regions: RegionInfo[];
  isLoading: boolean;
  switchRegion: (regionId: string) => void;
  refreshRegions: () => Promise<void>;
}

const RegionContext = createContext<RegionContextValue | undefined>(undefined);

export function RegionProvider({ children }: { children: React.ReactNode }) {
  const [regions, setRegions] = useState<RegionInfo[]>([]);
  const [activeRegion, setActiveRegion] = useState<RegionInfo | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const fetchRegions = async () => {
    try {
      const res = await fetch("/api/regions");
      const json = await res.json();
      if (json.success && Array.isArray(json.regions)) {
        setRegions(json.regions);

        // 获取上次本地选择或默认激活的地区
        const savedRegionId = localStorage.getItem("active_region_id");
        const matched =
          json.regions.find((r: RegionInfo) => r.id === savedRegionId) ||
          json.regions.find((r: RegionInfo) => r.id === json.defaultRegionId) ||
          json.regions[0] ||
          null;

        setActiveRegion(matched);
        if (matched) {
          document.cookie = `active_region=${matched.id}; path=/; max-age=31536000; SameSite=Lax`;
        }
      }
    } catch (err: any) {
      console.warn("[RegionProvider] Failed to fetch regions:", err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchRegions();
  }, []);

  const switchRegion = (regionId: string) => {
    const target = regions.find((r) => r.id === regionId);
    if (!target) return;

    setActiveRegion(target);
    localStorage.setItem("active_region_id", target.id);
    document.cookie = `active_region=${target.id}; path=/; max-age=31536000; SameSite=Lax`;
    toast.success(`已切换至【${target.city} · ${target.name} 12345 站点】`);

    // 重新刷新页面以让所有 SSR 和组件获取对应 Schema 数据
    setTimeout(() => {
      window.location.reload();
    }, 400);
  };

  return (
    <RegionContext.Provider
      value={{
        activeRegion,
        regions,
        isLoading,
        switchRegion,
        refreshRegions: fetchRegions,
      }}
    >
      {children}
    </RegionContext.Provider>
  );
}

export function useRegion() {
  const ctx = useContext(RegionContext);
  if (!ctx) {
    throw new Error("useRegion must be used within a RegionProvider");
  }
  return ctx;
}
