/**
 * dev 只在端口空着、二进制和 F16 权重都在时启动嵌入。不拉起进程。
 */
import {
  EMBED_DEV_PORT,
  embedDevAction,
  embedEndpointsWithLocal,
  embedServerArgs,
} from "../packages/civic-embed/scripts/serve";

function assert(cond: unknown, message: string) {
  if (!cond) {
    console.error(`FAIL ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS ${message}`);
  }
}

assert(embedDevAction({ portOpen: true, hasBin: true, hasModel: true }) === "reuse", "8133 已开就复用，不再起一份");
assert(embedDevAction({ portOpen: false, hasBin: true, hasModel: true }) === "start", "端口空着且权重在才启动");
assert(embedDevAction({ portOpen: false, hasBin: true, hasModel: false }) === "skip", "没有 F16 权重不启动");
assert(embedDevAction({ portOpen: false, hasBin: false, hasModel: true }) === "skip", "没有 llama-server 不启动");

const args = embedServerArgs("/models/bge-m3-F16.gguf");
assert(args.includes("--embedding"), "服务只做嵌入");
assert(args.includes("BAAI/bge-m3"), "对外模型名是 BAAI/bge-m3");
assert(args.includes(String(EMBED_DEV_PORT)), "开发端口是 8133");
assert(args.includes("-b") && args[args.indexOf("-b") + 1] === "32", "Mac 批量是 32");
assert(args.includes("-np") && args[args.indexOf("-np") + 1] === "1", "同时只跑一个批次");
assert(!args.some((arg) => /q4|q8/i.test(arg)), "启动参数里没有低精度");

assert(
  embedEndpointsWithLocal("http://127.0.0.1:8133/v1", "https://api.edgefn.net/v1") ===
    "http://127.0.0.1:8133/v1,https://api.edgefn.net/v1",
  "本机端点在前，原来的云端留作备用"
);
assert(
  embedEndpointsWithLocal("http://127.0.0.1:8133/v1", "http://127.0.0.1:8133/v1,https://api.edgefn.net/v1") ===
    "http://127.0.0.1:8133/v1,https://api.edgefn.net/v1",
  "本机地址不重复写"
);

if (process.exitCode) process.exit(process.exitCode);
