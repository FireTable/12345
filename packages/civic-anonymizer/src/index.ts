/**
 * @civic/anonymizer
 * 12345 政务工单全要素可逆脱敏引擎与实体回填状态机
 */

export * from "./types";
export * from "./tokenizer";
export * from "./detectors";
export * from "./conflict-resolver";
export * from "./engine";

import { anonymize, deanonymize, batchAnonymize } from "./engine";

export const CivicAnonymizer = {
  anonymize,
  deanonymize,
  batchAnonymize,
};
