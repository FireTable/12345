"use client";

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import type { AppDomainMode } from "@/lib/app-domain";

export type { AppDomainMode };
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
  appDomain: AppDomainMode;
  activeRegion: RegionInfo | null;
  regions: RegionInfo[];
  isLoading: boolean;
  switchRegion: (regionId: string) => void;
  refreshRegions: () => Promise<void>;
}

const RegionContext = createContext<RegionContextValue | undefined>(undefined);

export function RegionProvider({
  children,
  initialAppDomain = "GOV_12345",
}: {
  children: React.ReactNode;
  initialAppDomain?: AppDomainMode;
}) {
  const [appDomain, setAppDomain] = useState<AppDomainMode>(initialAppDomain);
  const [regions, setRegions] = useState<RegionInfo[]>([]);
  const [activeRegion, setActiveRegion] = useState<RegionInfo | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const pathname = usePathname();
  const router = useRouter();
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  const refreshedCookie = useRef(false);
  const loadedOnceRef = useRef(false);
  const inFlightRef = useRef<Promise<void> | null>(null);

  const fetchRegions = useCallback(
    async (force = false) => {
      const currentPath = pathnameRef.current;
      if (currentPath === "/login") {
        setIsLoading(false);
        return;
      }
      if (!force && inFlightRef.current) {
        return inFlightRef.current;
      }

      let task: Promise<void> | undefined;
      task = (async () => {
        try {
          if (!loadedOnceRef.current) {
            setIsLoading(true);
          }
          // 首次/常规加载复用 HTTP 缓存（public, max-age=30, swr=120）；
          // 管理员变更站点后调用 refreshRegions() 传 force=true 强制穿透缓存。
          const res = await fetch("/api/regions", force ? { cache: "no-store" } : undefined);
          if (res.status === 401) {
            if (typeof window !== "undefined" && window.location.pathname !== "/login") {
              window.location.href = `/login?from=${encodeURIComponent(window.location.pathname)}`;
            }
            return;
          }
          const json = await res.json();
          if (json.appDomain === "GOV_12345" || json.appDomain === "ECOMMERCE_CS" || json.appDomain === "ALL") {
            setAppDomain(json.appDomain);
          }

          if (Array.isArray(json.regions)) {
            loadedOnceRef.current = true;
            setRegions(json.regions);

            const savedRegionId = localStorage.getItem("civic_active_region");
            const matched =
              json.regions.find((r: RegionInfo) => r.id === savedRegionId) ||
              json.regions.find((r: RegionInfo) => r.id === json.defaultRegionId) ||
              json.regions[0] ||
              null;

            setActiveRegion(matched);
            if (matched) {
              if (
                savedRegionId &&
                savedRegionId !== matched.id &&
                !json.regions.some((r: RegionInfo) => r.id === savedRegionId)
              ) {
                localStorage.setItem("civic_active_region", matched.id);
              }
              const prev = document.cookie.match(/(?:^|; )active_region=([^;]*)/)?.[1] || "";
              const prevId = prev ? decodeURIComponent(prev) : "";
              document.cookie = `active_region=${encodeURIComponent(matched.id)}; path=/; max-age=31536000; SameSite=Lax`;
              if (pathnameRef.current !== "/login" && prevId && prevId !== matched.id && !refreshedCookie.current) {
                refreshedCookie.current = true;
                router.refresh();
              }
            }
          }
        } catch (err: unknown) {
          console.warn("[RegionProvider] Failed to fetch regions:", err instanceof Error ? err.message : String(err));
        } finally {
          setIsLoading(false);
          if (inFlightRef.current === task) {
            inFlightRef.current = null;
          }
        }
      })();

      inFlightRef.current = task;
      return task;
    },
    [router]
  );

  const refreshRegions = useCallback(() => fetchRegions(true), [fetchRegions]);

  useEffect(() => {
    if (pathname === "/login") {
      setIsLoading(false);
      return;
    }
    // 仅在尚未加载站点列表时拉取一次，切页导航不再重复打 /api/regions 并阻塞页面渲染
    if (!loadedOnceRef.current) {
      void fetchRegions(false);
    }
  }, [pathname, fetchRegions]);

  const switchRegion = (regionId: string) => {
    const target = regions.find((r) => r.id === regionId);
    if (!target) return;

    setActiveRegion(target);
    localStorage.setItem("civic_active_region", target.id);
    document.cookie = `active_region=${encodeURIComponent(target.id)}; path=/; max-age=31536000; SameSite=Lax`;
    const isEcom = target.domainProfile?.domainType === "ECOMMERCE_CS";
    toast.success(
      isEcom
        ? `已切换至【${target.city} · ${target.name}】`
        : `已切换至【${target.city} · ${target.name} 12345 站点】`
    );

    // 用 router.refresh() 重新拉服务端组件（带新 cookie），避免整页 reload
    // 引起的双 fetch + 闪烁。客户端组件状态（抽屉、画布位置等）会保留。
    router.refresh();
  };

  return (
    <RegionContext.Provider
      value={{
        appDomain,
        activeRegion,
        regions,
        isLoading,
        switchRegion,
        refreshRegions,
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
