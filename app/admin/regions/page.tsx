import { requireAdminPage } from "@/lib/auth/page-guard";
import RegionsClient from "./regions-client";

export default async function AdminRegionsPage() {
  await requireAdminPage("/admin/regions");
  return <RegionsClient />;
}
