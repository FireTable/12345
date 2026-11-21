import { requireAdminPage } from "@/lib/auth/page-guard";
import DashboardClient from "./dashboard-client";

export default async function DashboardPage() {
  await requireAdminPage("/");
  return <DashboardClient />;
}
