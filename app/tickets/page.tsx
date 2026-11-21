import { requireAdminPage } from "@/lib/auth/page-guard";
import TicketsClient from "./tickets-client";

export default async function TicketsPage() {
  await requireAdminPage("/tickets");
  return <TicketsClient />;
}
