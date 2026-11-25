import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/auth/page-guard";
import ScreenClient from "./screen-client";

export const metadata: Metadata = {
  title: "全景指挥大屏",
};

export default async function BigScreenPage() {
  await requireAdminPage("/screen");
  return <ScreenClient />;
}
