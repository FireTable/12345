import { requireAdminPage } from "@/lib/auth/page-guard";
import ThemesClient from "./themes-client";

export default async function ThemesPage() {
  await requireAdminPage("/themes");
  return <ThemesClient />;
}
