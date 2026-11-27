# 民声智理 · Google Colab / 远程 GPU 算力部署套件

本目录提供将 Google Colab（L4 / T4 / A100）或任意 Linux GPU 服务器快速接入「民声智理」动态算力池的完整部署套件，默认模型与推理参数已完全对齐生产/本地集群（**Ternary Bonsai 2.5 27B + `BAAI/bge-m3`**）：

| 文件 | 用途 |
| --- | --- |
| `colab_ctl.py` | 本机一键 Colab 编排 CLI（封装 `pnpm colab:up/status/test/stop/verify`，按环境变量 > 仓库 `.env.local`/`.env` > `~/.agents/.env` 自动读取凭证、开通 VM、注入脚本、轮询就绪、落盘加密会话并兜底销毁） |
| `serve_colab.py` | 一键 GPU 探测与双引擎启动脚本（`8132` `ninfer-serve` 运行 `bonsai-2-27b` + `8133` `BAAI/bge-m3` 含 `/embed/*` 路由别名 + 强制 Bearer Token 鉴权 + Named/Quick Tunnel 穿透） |
| `civic_colab_worker.ipynb` | 标准 Jupyter Notebook（nbformat 4），支持在 Google Colab 浏览器端分步检查 GPU、安装轻量化依赖、配置参数并拉起服务 |
| `README.md` | 本文档：命令行一键运维指引、单域名 Named Tunnel 免复制模式、Notebook 上传指引、后台热挂载与隧道安全/成本管控说明 |

---

## 一、命令行一键拉起（推荐，基于本地 CLI）

项目根目录已在 `package.json` 注册了全套 Colab 一键生命周期命令，无需手动打开浏览器上传 Notebook 即可完成算力开通、端到端验活与计费熔断（前置需本机已配置并登录 `colab` CLI）：

### 单域名固定隧道（Named Tunnel，零 URL/Token 复制粘贴）

若按优先级在 **环境变量 > 仓库 `.env.local` / `.env` > `~/.agents/.env`**（`0600` 权限）中配置以下变量：

- `CIVIC_COLAB_TUNNEL_TOKEN`：Cloudflare Named Tunnel 令牌（对应固定域名 `civic-colab.firetable.tech`，边缘路由 `/v1` → `:8132` LLM、`/embed/v1` → `:8133` Embedding）
- `CIVIC_COLAB_API_KEY`（可选，未设则生成临时高强度密钥）：固定 Bearer 鉴权密钥
- `CIVIC_COLAB_HOSTNAME`（可选，默认 `civic-colab.firetable.tech`）：公网域名

执行 `pnpm colab:up`（默认 `--tunnel auto`）时将**自动选择 `named` 模式**：
1. 宿主机仅在内存中读取上述凭证，并通过 `0600` 文件 `/tmp/civic_colab_secrets.env` 注入 Colab VM（**绝不出现在进程命令行、`ps`、`/tmp/civic_colab.log` 或终端输出中**）；
2. `serve_colab.py` 启动后固定暴露：
   - **System-2 LLM**：`https://civic-colab.firetable.tech/v1`
   - **Embedding**：`https://civic-colab.firetable.tech/embed/v1`
3. 配合 `.env.vps` 预先挂载上述固定端点与 `CIVIC_COLAB_API_KEY`，每次 `pnpm colab:up` 后无需再修改后台配置或复制粘贴随机 URL/Token。若未检测到 `CIVIC_COLAB_TUNNEL_TOKEN`，`--tunnel auto` 将无缝回退至 `cloudflared` Quick Tunnel（`trycloudflare.com`）。

```bash
# 1. 一键拉起 Colab GPU（默认 L4 24GB + bonsai-2-27b + BAAI/bge-m3 + --tunnel auto）
#    已配 CIVIC_COLAB_TUNNEL_TOKEN 时自动启用 named 单域名隧道；否则自动回退 cloudflared Quick Tunnel
pnpm colab:up

# 可选覆盖 GPU 档位、隧道模式、自定义域名、会话名，或显式打印一次性 Bearer Token：
pnpm colab:up -- --gpu T4|L4|A100 --tunnel auto|named|cloudflared|tailscale --public-host civic-colab.firetable.tech --session <name> --show-token

# 2. 查看实时 GPU 显存占用与双端点运行状态
pnpm colab:status

# 3. 执行完整端到端连通与鉴权测试（兼容 named / cloudflared：401 鉴权拦截 / /v1/models & /embed/v1/models 200 / 流式对话 / 1024 维向量）
pnpm colab:test

# 4. 停止推理进程、清理 VM /tmp/civic_colab_secrets.env 并销毁 Colab VM，立即终止计算单元（CU）计费
pnpm colab:stop

# 5. 全自动闭环验收：一键拉起 → 完整 E2E 测试 → 无论成功或失败均自动销毁 VM
pnpm colab:verify
```

- **会话凭证隔离存储**：`colab:up` 会将 `{session, llm_url, embed_url, token}` 安全写入 `~/.cache/civic-colab/<session>.json`（文件权限 `0600`）。终端默认对 Token 脱敏掩码展示（仅显式传入 `-- --show-token` 时输出一次，且 `colab:status` / `colab:test` 永不回显明文 Token 或 Tunnel Token）。
- **并发配置建议**：在后端接入 Colab 节点池时，可在 `.env.local` / `.env.vps` 中配置 `SYSTEM_TWO_CONCURRENCY=4`（Colab L4 / A100，对应 `--max-concurrency 4`）或 `SYSTEM_TWO_CONCURRENCY=2`（T4 16GB），充分释放 `ninfer-serve` MTP 批处理吞吐。

---

## 二、在 Google Colab 浏览器 Notebook 中打开并运行（可选）

1. 打开 [Google Colab](https://colab.research.google.com/)，选择 **文件 (File) → 上传笔记本 (Upload notebook)**，上传本目录下的 `civic_colab_worker.ipynb`。
2. 在菜单栏点击 **代码执行程序 (Runtime) → 更改运行时类型 (Change runtime type)**，将硬件加速器设为 **GPU**（推荐 **L4 24GB** 或 **A100 40GB/80GB**；免费版 **T4 16GB** 亦可直接运行 Bonsai 2.5 27B PQ2_0）。
3. 依次运行 Notebook 中的 4 个步骤：
   - **Step 1**：运行 `nvidia-smi` 确认 GPU 型号与显存容量。
   - **Step 2**：选择后端（默认 `ninfer`，仅装轻量化依赖，无需安装耗时且易冲突的 `vllm`）与隧道模式（默认 `cloudflared`，单域名固定隧道可选 `named`，均使用 `cloudflared` 二进制）；若 Colab 工作区尚未包含 `serve_colab.py`，按提示直接上传 `scripts/colab/serve_colab.py`。
   - **Step 3**：配置参数（`API_KEY` 留空将优先读取 `CIVIC_COLAB_API_KEY` / Colab Secrets，否则通过 `secrets.token_urlsafe(24)` 自动生成高强度随机 Token；`named` 模式下通过 Colab Secrets `CIVIC_COLAB_TUNNEL_TOKEN` 或环境变量注入隧道令牌；`LLM_MODEL` 留空默认使用 `WaveCut/Ternary-Bonsai-2.5-27B-PQ2_0-NInfer-v3` 并映射为 `bonsai-2-27b`）。
   - **Step 4**：启动双推理引擎并等待控制台输出结构化接入信息，包含：
     - `SYSTEM_TWO` Endpoint URL（`named` 模式为 `https://civic-colab.firetable.tech/v1`，`cloudflared` 模式为 `https://<random>.trycloudflare.com/v1`）
     - `EMBEDDING` Endpoint URL（`named` 模式为 `https://civic-colab.firetable.tech/embed/v1`，`cloudflared` 模式为 `https://<random>.trycloudflare.com/v1`）
     - Bearer Token 与模型名称（`bonsai-2-27b` / `BAAI/bge-m3`）

---

## 三、热挂载到「民声智理」算力集群面板

无需重启「民声智理」Next.js 服务或修改 `.env`，直接通过后台面板热生效：

1. 登录「民声智理」管理后台，进入 **多站点与算力管理** 页面（`/admin/regions`），找到 **「算力集群与 Colab GPU」** 面板。
2. 点击 **「接入 Colab GPU / 算力节点」**，按 `pnpm colab:up -- --show-token` 或 Colab Notebook Step 4 输出（亦可从本机 `~/.cache/civic-colab/<session>.json` 读取）依次录入两个节点（或按需接入单个节点）：
   - **节点 1（System-2 大模型）**
     - 节点名称：例如 `Colab L4 GPU (Bonsai 2.5)`
     - 节点角色：`SYSTEM_TWO`
     - 节点来源：`COLAB`
     - Endpoint URL：粘贴 `8132` 对应的 `https://.../v1` 地址
     - Bearer Token：粘贴控制台生成的 Token
     - 模型名称：粘贴控制台显示的模型名（默认 `bonsai-2-27b`）
   - **节点 2（向量嵌入，可选）**
     - 节点名称：例如 `Colab L4 GPU (Embedding)`
     - 节点角色：`EMBEDDING`
     - 节点来源：`COLAB`
     - Endpoint URL：粘贴 `8133` 对应的 `https://.../v1` 地址
     - Bearer Token：粘贴同一个 Token
     - 模型名称：`BAAI/bge-m3`
3. 点击 **「先探测连通性」** 验证返回 `ONLINE` 状态、公网隧道延迟及 `/v1/models` 列表后，点击 **「确认加入算力池」** 即可即时参与负载均衡调度。

---

## 四、Linux / Windows GPU 服务器命令行直连（可选）

若在自有 Linux GPU 主机或租用算力卡上运行，可直接执行脚本（参数均支持命令行覆盖）：

```bash
# 默认方式：自动下载 ninfer-serve + Bonsai 2.5 27B，并通过 Cloudflare Quick Tunnel 暴露双服务
python3 scripts/colab/serve_colab.py --tunnel cloudflared

# 单域名 Named Tunnel 模式（从 CIVIC_COLAB_TUNNEL_TOKEN / COLAB_API_KEY 注入，不把密钥写进命令行）
CIVIC_COLAB_TUNNEL_TOKEN="<your-tunnel-token>" COLAB_API_KEY="<your-strong-token>" \
  python3 scripts/colab/serve_colab.py --tunnel named --public-host civic-colab.firetable.tech

# 使用 Tailscale 加密内网组网（自动检测 tailscale ip -4）
python3 scripts/colab/serve_colab.py --tunnel tailscale

# 指定已有 ninfer-serve / 本地权重路径，或覆盖并发与 KV 上下文参数
python3 scripts/colab/serve_colab.py \
  --ninfer-bin /path/to/ninfer-serve \
  --llm-model /path/to/Ternary-Bonsai-2.5-27B-PQ2_0-ninfer-v3.ninfer \
  --max-concurrency 4 \
  --kv-capacity 65536 \
  --tunnel tailscale

# 可选回退后端：vLLM / llama-cpp（传入自定义密钥建议用环境变量注入）
COLAB_API_KEY="<your-strong-token>" python3 scripts/colab/serve_colab.py \
  --llm-backend vllm \
  --tunnel cloudflared

# 仅打印硬件探测与模型推荐结果（含 named 隧道命令脱敏预览），不实际下载与启动服务；或按需跳过单引擎
python3 scripts/colab/serve_colab.py --tunnel named --dry-run
python3 scripts/colab/serve_colab.py --skip-embed --tunnel tailscale
```

常用参数：`--llm-backend`（默认 `ninfer`，可选 `vllm` / `llama-cpp`）、`--llm-model`、`--llm-alias`（`ninfer` 默认 `bonsai-2-27b`）、`--embed-model`（默认 `BAAI/bge-m3`）、`--llm-port`（默认 `8132`）、`--embed-port`（默认 `8133`）、`--max-concurrency`、`--kv-capacity`、`--kv-dtype`、`--host-cache-mib`、`--no-mtp`、`--tunnel`（`named` / `cloudflared` / `tailscale` / `none`）、`--tunnel-token`（默认读取 `CIVIC_COLAB_TUNNEL_TOKEN` / `COLAB_TUNNEL_TOKEN`）、`--public-host`（默认读取 `CIVIC_COLAB_HOSTNAME` 或 `civic-colab.firetable.tech`）、`--skip-llm`、`--skip-embed`、`--startup-timeout`（默认 `600` 秒）、`--dry-run`。

### 显存自动推荐策略

#### 1. 默认 `ninfer` 后端（Ternary Bonsai 2.5 27B PQ2_0，模型名 `bonsai-2-27b`，权重约 `7.09 GiB`）

| GPU 显存档位 | 最大上下文 (`--max-context`) | 共享 KV (`--kv-capacity`) | KV 精度 (`--kv-dtype`) | 并发 (`--max-concurrency`) | 投机解码 (`--spec`) |
| --- | --- | --- | --- | --- | --- |
| `>= 70 GB` (A100 80GB / H100) | `65536` | `131072` | `rk8v4` | `4` | `mtp` (3 draft + lm-head) |
| `>= 36 GB` (A100 40GB) | `65536` | `65536` | `rk8v4` | `4` | `mtp` (3 draft + lm-head) |
| `>= 20 GB` (L4 24GB / 3090 / 4090) | `32768` | `65536` | `rk4v4` | `4` | `mtp` (3 draft + lm-head) |
| `>= 14 GB` (T4 16GB) | `32768` | `32768` | `rk4v4` | `2` | `mtp` (3 draft + lm-head) |
| `>= 10 GB` (12GB GPU 如 RTX 3080) | `32768` | `32768` | `rk4v4` | `2` | `mtp` (3 draft + lm-head) |

#### 2. 备选 `vllm` / `llama-cpp` 后端（Qwen2.5 回退策略）

| GPU 显存档位 | 默认 System-2 模型 (`vllm`) | 量化 / 精度 | 默认上下文长度 |
| --- | --- | --- | --- |
| `>= 70 GB` (A100 80GB) | `Qwen/Qwen2.5-32B-Instruct` | `bfloat16` | `8192` |
| `>= 36 GB` (A100 40GB) | `Qwen/Qwen2.5-14B-Instruct` | `bfloat16` | `8192` |
| `>= 20 GB` (L4 24GB) | `Qwen/Qwen2.5-14B-Instruct-AWQ` | `float16 + awq` | `8192` |
| `>= 14 GB` (T4 16GB) | `Qwen/Qwen2.5-7B-Instruct-AWQ` | `float16 + awq` | `4096` |
| `< 14 GB` / CPU 回退 | `Qwen/Qwen2.5-3B-Instruct` | `float16` / `float32` | `4096` |

---

## 五、隧道安全与成本管控注意事项

1. **强制 Bearer Token 鉴权与凭证隔离**：
   - 无论通过 `--api-key`、`CIVIC_COLAB_API_KEY` 传入还是自动通过 `secrets.token_urlsafe(24)` 生成，System-2（`8132`，`ninfer-serve --api-key`）与 `BAAI/bge-m3`（`8133`，`/v1/*` 与 `/embed/v1/*`）均强制校验 `Authorization: Bearer <token>`，未携带或错误凭证统一返回 `401`。
   - `colab:up` 从宿主机环境变量、仓库 `.env.local` / `.env` 或 `~/.agents/.env` 读取 `CIVIC_COLAB_TUNNEL_TOKEN` / `CIVIC_COLAB_API_KEY`，并通过 `0600` 文件 `/tmp/civic_colab_secrets.env` 注入 Colab VM（`source` 加载），不将任何密钥写入进程参数或 `/tmp/civic_colab.log`；执行 `pnpm colab:stop` 时会自动删除 `/tmp/civic_colab_secrets.env`。
   - 命令行模式下会话凭证仅保存于本机 `~/.cache/civic-colab/<session>.json`（`0600` 权限），切勿将该缓存文件、生成的 Token、`CIVIC_COLAB_TUNNEL_TOKEN` 或包含运行输出的 `.ipynb` 副本提交至 Git 仓库或截图公开。
   - 「民声智理」服务端落库后不会向前端回传明文密钥（仅返回 `hasApiKey` 与脱敏尾号）。
2. **隧道安全特性**：
   - `named` 单域名固定隧道通过 Cloudflare Tunnel 边缘映射 `https://civic-colab.firetable.tech/v1`（`:8132`）与 `https://civic-colab.firetable.tech/embed/v1`（`:8133`），配合 `.env.vps` 预配置实现零复制粘贴；`cloudflared` Quick Tunnel 每次启动生成一次性随机 `https://*.trycloudflare.com` 域名，进程退出即失效。
   - 若用于长期团队内部算力共享，亦可使用 `--tunnel tailscale`（或 `pnpm colab:up -- --tunnel tailscale`）走 WireGuard 加密内网访问。
3. **用完即释成本管控**：
   - 使用命令行模式时，任务完成后执行 `pnpm colab:stop` 即可停服并销毁 Colab VM；若仅做回归验收，优先使用 `pnpm colab:verify`，无论测试成功或异常均会自动销毁 VM 防止漏计费。
   - 使用浏览器 Notebook 模式时，务必在 Colab 中断 Step 4 单元，随后点击 **「代码执行程序 → 断开连接并删除运行时 (Disconnect and delete runtime)」** 停止计算单元（CU）计费，并在系统后台 **「算力集群与 Colab GPU」** 面板停用或删除已下线的临时节点。
