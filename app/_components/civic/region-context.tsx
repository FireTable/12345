"use client";

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";

export type DomainType = "GOV_12345" | "ECOMMERCE_CS";

export interface DomainTerminology {
  regionUnit: string;
  subject: string;
  ticketNoun: string;
  ownerNoun: string;
  themeNoun: string;
  fakeClosureLabel: string;
}

export interface DomainProfile {
  domainType: DomainType;
  displayName: string;
  badgeLabel: string;
  hasGeoMap: boolean;
  categories: string[];
  channels: string[];
  terminology: DomainTerminology;
  promptPersona?: string;
}

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
  domainProfile?: DomainProfile | null;
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

  const pathname = usePathname();
  const router = useRouter();
  const refreshedCookie = useRef(false);

  const fetchRegions = useCallback(async () => {
    // 登录页不触发，等登录成功后再拉取
    if (pathname === "/login") {
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      const res = await fetch("/api/regions");
      if (res.status === 401) {
        if (typeof window !== "undefined" && window.location.pathname !== "/login") {
          window.location.href = `/login?from=${encodeURIComponent(window.location.pathname)}`;
        }
        return;
      }
      const json = await res.json();
      if (json.success && Array.isArray(json.regions)) {
        setRegions(json.regions);

        // 新键只记用户这次主动切换。旧的 active_region_id 不再沿用，避免浏览器里留下的顺德盖住广州默认站。
        const savedRegionId = localStorage.getItem("civic_active_region");
        const matched =
          json.regions.find((r: RegionInfo) => r.id === savedRegionId) ||
          json.regions.find((r: RegionInfo) => r.id === json.defaultRegionId) ||
          json.regions[0] ||
          null;

        setActiveRegion(matched);
        if (matched) {
          const prev = document.cookie.match(/(?:^|; )active_region=([^;]*)/)?.[1] || "";
          const prevId = prev ? decodeURIComponent(prev) : "";
          document.cookie = `active_region=${matched.id}; path=/; max-age=31536000; SameSite=Lax`;
          if (prevId && prevId !== matched.id && !refreshedCookie.current) {
            refreshedCookie.current = true;
            router.refresh();
          }
        }
      }
    } catch (err: any) {
      console.warn("[RegionProvider] Failed to fetch regions:", err.message);
    } finally {
      setIsLoading(false);
    }
  }, [pathname, router]);

  // 初次加载与路由切换监控：一旦离开 /login 且无站点数据，立即重新拉取
  useEffect(() => {
    if (pathname !== "/login") {
      fetchRegions();
    }
  }, [pathname, fetchRegions]);

  const switchRegion = (regionId: string) => {
    const target = regions.find((r) => r.id === regionId);
    if (!target) return;

    setActiveRegion(target);
    localStorage.setItem("civic_active_region", target.id);
    document.cookie = `active_region=${target.id}; path=/; max-age=31536000; SameSite=Lax`;
    toast.success(`已切换至【${target.city} · ${target.name} 12345 站点】`);

    // 用 router.refresh() 重新拉服务端组件（带新 cookie），避免整页 reload
    // 引起的双 fetch + 闪烁。客户端组件状态（抽屉、画布位置等）会保留。
    router.refresh();
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
