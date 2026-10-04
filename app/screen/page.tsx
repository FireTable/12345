"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { CockpitView } from "@/app/_components/cockpit/cockpit-view";

export default function BigScreenPage() {
  const router = useRouter();

  return <CockpitView onClose={() => router.push("/")} />;
}
