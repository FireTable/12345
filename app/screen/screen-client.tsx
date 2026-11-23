"use client";

import React, { useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CockpitView } from "@/app/_components/cockpit/cockpit-view";
import { useRegion } from "@/app/_components/civic/region-context";
import { useAuthRole } from "@/lib/auth/use-role";

function ScreenInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { switchRegion, activeRegion, regions, isLoading: regionLoading } = useRegion();
  const { isAdmin, isPending: isRolePending } = useAuthRole();
  const regionParam = searchParams.get("region");
  const appliedRegionParamRef = React.useRef<string | null>(null);

  useEffect(() => {
    if (isRolePending || !isAdmin || regionLoading) return;
    if (!regionParam) {
      appliedRegionParamRef.current = null;
      return;
    }
    if (appliedRegionParamRef.current === regionParam) return;
    appliedRegionParamRef.current = regionParam;
    if (activeRegion?.id !== regionParam && regions.some((r) => r.id === regionParam)) {
      switchRegion(regionParam);
    }
  }, [regionParam, regionLoading, regions, activeRegion?.id, switchRegion, isRolePending, isAdmin]);

  if (isRolePending || !isAdmin) {
    return <div className="w-screen h-screen bg-[#020612]" />;
  }

  return <CockpitView modal={false} onClose={() => router.push("/")} />;
}

export default function BigScreenPage() {
  return (
    <Suspense fallback={<div className="w-screen h-screen bg-[#020612]" />}>
      <ScreenInner />
    </Suspense>
  );
}
