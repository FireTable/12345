import { requireAdminPage } from "@/lib/auth/page-guard";
import SandboxClient from "./sandbox-client";

export default async function SandboxXrayPage() {
  await requireAdminPage("/sandbox");
  return <SandboxClient />;
}
