import { StateGraph, START, END } from "@langchain/langgraph";
import { TicketRadarStateAnnotation } from "../state";
import { memoryCheckpointer } from "../checkpointer";
import { extractNode } from "../node/extract-node";
import { canonicalNode } from "../node/canonical-node";
import { embedNode } from "../node/embed-node";
import { clusterNode } from "../node/cluster-node";
import { summaryNode } from "../node/summary-node";

/**
 * Ticket Radar LangGraph Agent
 * Multi-Stage GraphRAG Pipeline:
 * START -> extract -> canonical -> embed -> cluster -> summary -> END
 */
const workflow = new StateGraph(TicketRadarStateAnnotation)
  .addNode("extract", extractNode)
  .addNode("canonical", canonicalNode)
  .addNode("embed", embedNode)
  .addNode("cluster", clusterNode)
  .addNode("summary", summaryNode)
  .addEdge(START, "extract")
  .addEdge("extract", "canonical")
  .addEdge("canonical", "embed")
  .addEdge("embed", "cluster")
  .addEdge("cluster", "summary")
  .addEdge("summary", END);

export const graph = workflow.compile({
  checkpointer: memoryCheckpointer,
});
