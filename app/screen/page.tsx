import { requireAdminPage } from "@/lib/auth/page-guard";
import ScreenClient from "./screen-client";

export default async function BigScreenPage() {
  await requireAdminPage("/screen");
  return <ScreenClient />;
}
