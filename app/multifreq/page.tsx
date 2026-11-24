import { requireAdminPage } from "@/lib/auth/page-guard";
import MultifreqClient from "./multifreq-client";

export default async function MultifreqPage() {
  await requireAdminPage("/multifreq");
  return <MultifreqClient />;
}
