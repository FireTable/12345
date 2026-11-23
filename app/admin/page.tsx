import { redirect } from "next/navigation";
import { requireAdminPage } from "@/lib/auth/page-guard";

export default async function AdminIndexPage() {
  await requireAdminPage("/admin");
  redirect("/");
}
