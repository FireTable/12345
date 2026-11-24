import { requireAdminPage } from "@/lib/auth/page-guard";
import DictClient from "./dict-client";

export default async function DictionaryManagementPage() {
  await requireAdminPage("/dict");
  return <DictClient />;
}
