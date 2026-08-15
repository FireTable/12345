import { MemorySaver } from "@langchain/langgraph";

/**
 * Persistent In-Memory / Postgres Checkpointer for LangGraph
 * Reused and aligned with langgraph-app persistent graph execution.
 */
export const memoryCheckpointer = new MemorySaver();
