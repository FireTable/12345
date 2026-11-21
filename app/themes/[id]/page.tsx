import { requireAdminPage } from "@/lib/auth/page-guard";
import ThemeDetailClient from "./theme-detail-client";

export default async function ThemeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireAdminPage(`/themes/${id}`);
  return <ThemeDetailClient />;
}
