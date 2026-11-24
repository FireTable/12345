import { requireAdminPage } from "@/lib/auth/page-guard";
import TicketDetailClient from "./ticket-detail-client";

export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireAdminPage(`/tickets/${id}`);
  return <TicketDetailClient />;
}
