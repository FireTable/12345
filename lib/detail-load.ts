export type DetailLoadStatus = "pending" | "done" | "error";
export type DetailView = "loading" | "missing" | "ready";

export function classifyDetailPayload(
  status: DetailLoadStatus,
  payload: { success?: boolean } | null
): DetailView {
  if (status === "pending") return "loading";
  if (status === "error" || !payload || payload.success === false) return "missing";
  return "ready";
}
