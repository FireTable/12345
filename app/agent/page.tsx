import { requireAdminPage } from "@/lib/auth/page-guard";
import AgentClient from "./agent-client";

export default async function AgentCenterPage() {
  await requireAdminPage("/agent");
  return <AgentClient />;
}
