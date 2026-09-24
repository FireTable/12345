import { graph } from "./agent/ticket-agent";
import type { RawTicket, TicketRadarState } from "./state";

export { graph };

/**
 * Execute the Ticket Radar Agent Pipeline on a set of tickets
 */
export async function runTicketRadarPipeline(
  rawTickets: RawTicket[],
  threadId: string = "default-radar-thread",
  taskId?: string,
  regionId?: string
): Promise<TicketRadarState> {
  const initialState = {
    rawTickets,
    taskId,
    regionId,
    status: "idle" as const,
  };

  const result = await graph.invoke(initialState, {
    configurable: { thread_id: threadId },
  });

  return result as TicketRadarState;
}
