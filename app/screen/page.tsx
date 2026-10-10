"use client";

import React, { useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CockpitView } from "@/app/_components/cockpit/cockpit-view";
import { useRegion } from "@/app/_components/civic/region-context";

function ScreenInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { switchRegion, activeRegion } = useRegion();
  const regionParam = searchParams.get("region");

  useEffect(() => {
    if (regionParam && activeRegion?.id !== regionParam) {
      switchRegion(regionParam);
    }
  }, [regionParam, activeRegion?.id, switchRegion]);

  return <CockpitView onClose={() => router.push("/")} />;
}

export default function BigScreenPage() {
  return (
    <Suspense fallback={<div className="w-screen h-screen bg-[#020612]" />}>
      <ScreenInner />
    </Suspense>
  );
}
