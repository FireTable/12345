/**
 * 拉模型只认这份 F16，不下载。
 */
import {
  EMBED_WEIGHT_BYTES,
  EMBED_WEIGHT_FILE,
  EMBED_WEIGHT_SHA256,
  EMBED_WEIGHT_URL,
  weightFileNameIsF16,
  weightFileStatus,
} from "../packages/civic-embed/scripts/pull";

function assert(cond: unknown, message: string) {
  if (!cond) {
    console.error(`FAIL ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS ${message}`);
  }
}

assert(weightFileNameIsF16(EMBED_WEIGHT_FILE), "默认文件名是 F16");
assert(!weightFileNameIsF16("bge-m3-Q4_K_M.gguf"), "Q4 不在可拉取的名字里");
assert(!weightFileNameIsF16("bge-m3-Q8_0.gguf"), "Q8 不在可拉取的名字里");
assert(EMBED_WEIGHT_URL.endsWith("/bge-m3-F16.gguf"), "下载地址指向 F16 文件");
assert(
  weightFileStatus(EMBED_WEIGHT_BYTES, EMBED_WEIGHT_SHA256) === "ready",
  "大小和校验都对才算已经拉好"
);
assert(weightFileStatus(null, null) === "missing", "没有文件就是还没拉");
assert(weightFileStatus(EMBED_WEIGHT_BYTES - 1, null) === "incomplete", "没下完可以续");
assert(
  weightFileStatus(EMBED_WEIGHT_BYTES, "0".repeat(64)) === "mismatch",
  "大小对但校验不对不能当成 F16"
);

if (process.exitCode) process.exit(process.exitCode);
