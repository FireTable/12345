"use client";

import React, { useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CockpitView } from "@/app/_components/cockpit/cockpit-view";
import { useRegion } from "@/app/_components/civic/region-context";
import { useAuthRole } from "@/lib/auth/use-role";

function ScreenInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { switchRegion, activeRegion } = useRegion();
  const { isAdmin, isPending: isRolePending } = useAuthRole();
  const regionParam = searchParams.get("region");

  useEffect(() => {
    if (isRolePending || !isAdmin) return;
    if (regionParam && activeRegion?.id !== regionParam) {
      switchRegion(regionParam);
    }
  }, [regionParam, activeRegion?.id, switchRegion, isRolePending, isAdmin]);

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
