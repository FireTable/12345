import type { CivicTicketInput, CivicSystemOneDecision, CivicEvaluateOptions } from "../types";

export interface DecisionAdapter {
  readonly name: "mps" | "onnx" | "fallback";
  isAvailable(): Promise<boolean>;
  evaluate(ticket: CivicTicketInput, options?: CivicEvaluateOptions): Promise<CivicSystemOneDecision>;
  close?(): Promise<void>;
}
