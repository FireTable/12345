# 民声智理 · Google Colab / 远程 GPU 算力部署套件

本目录提供将 Google Colab（L4 / T4 / A100）或任意 Linux GPU 服务器快速接入「民声智理」动态算力池的完整部署套件：

| 文件 | 用途 |
| --- | --- |
| `serve_colab.py` | 一键 GPU 探测与双引擎启动脚本（`8132` System-2 LLM + `8133` `BAAI/bge-m3` Embedding + 强制 Bearer Token 鉴权 + 隧道穿透） |
| `civic_colab_worker.ipynb` | 标准 Jupyter Notebook（nbformat 4），支持在 Google Colab 分步检查 GPU、安装依赖、配置参数并拉起服务 |
| `README.md` | 本文档：Colab 上传指引、后台热挂载流程与隧道安全/成本管控说明 |

---

## 一、在 Google Colab 中打开并运行

1. 打开 [Google Colab](https://colab.research.google.com/)，选择 **文件 (File) → 上传笔记本 (Upload notebook)**，上传本目录下的 `civic_colab_worker.ipynb`。
2. 在菜单栏点击 **代码执行程序 (Runtime) → 更改运行时类型 (Change runtime type)**，将硬件加速器设为 **GPU**（推荐 **L4 24GB** 或 **A100 40GB**；免费版 **T4 16GB** 亦可自动匹配 7B AWQ 模型）。
3. 依次运行 Notebook 中的 4 个步骤：
   - **Step 1**：运行 `nvidia-smi` 确认 GPU 型号与显存容量。
   - **Step 2**：选择后端（默认 `vllm`）与隧道模式（默认 `cloudflared`）并安装依赖；若 Colab 工作区尚未包含 `serve_colab.py`，按提示直接上传 `scripts/colab/serve_colab.py`。
   - **Step 3**：配置参数（`API_KEY` 留空将在运行时通过 `secrets.token_urlsafe(24)` 自动生成高强度随机 Token；`LLM_MODEL` 留空将按 GPU 显存自动推荐）。
   - **Step 4**：启动双推理引擎并等待控制台输出结构化接入信息，包含：
     - `SYSTEM_TWO` Endpoint URL（`https://<random>.trycloudflare.com/v1`）
     - `EMBEDDING` Endpoint URL（`https://<random>.trycloudflare.com/v1`）
     - Bearer Token 与模型名称

---

## 二、热挂载到「民声智理」算力集群面板

无需重启「民声智理」Next.js 服务或修改 `.env`，直接通过后台面板热生效：

1. 登录「民声智理」管理后台，进入 **多站点与算力管理** 页面（`/admin/regions`），找到 **「算力集群与 Colab GPU」** 面板。
2. 点击 **「接入 Colab GPU / 算力节点」**，按 Colab Step 4 控制台输出依次录入两个节点（或按需接入单个节点）：
   - **节点 1（System-2 大模型）**
     - 节点名称：例如 `Colab L4 GPU (System-2)`
     - 节点角色：`SYSTEM_TWO`
     - 节点来源：`COLAB`
     - Endpoint URL：粘贴 `8132` 对应的 `https://.../v1` 地址
     - Bearer Token：粘贴控制台生成的 Token
     - 模型名称：粘贴控制台显示的模型名（如 `Qwen/Qwen2.5-14B-Instruct-AWQ`）
   - **节点 2（向量嵌入，可选）**
     - 节点名称：例如 `Colab L4 GPU (Embedding)`
     - 节点角色：`EMBEDDING`
     - 节点来源：`COLAB`
     - Endpoint URL：粘贴 `8133` 对应的 `https://.../v1` 地址
     - Bearer Token：粘贴同一个 Token
     - 模型名称：`BAAI/bge-m3`
3. 点击 **「先探测连通性」** 验证返回 `ONLINE` 状态、公网隧道延迟及 `/v1/models` 列表后，点击 **「确认加入算力池」** 即可即时参与负载均衡调度。

---

## 三、Linux GPU 服务器命令行直连（可选）

若在自有 Linux GPU 主机或租用算力卡上运行，可直接执行脚本（参数均支持命令行覆盖）：

```bash
# 使用 Cloudflare Quick Tunnel 一键暴露双服务（自动生成随机 Bearer Token）
python3 scripts/colab/serve_colab.py --tunnel cloudflared

# 使用 Tailscale 加密内网组网（自动检测 tailscale ip -4）
python3 scripts/colab/serve_colab.py --tunnel tailscale

# 使用 llama-cpp 后端加载 GGUF 模型，或显式传入自定义密钥（建议通过环境变量注入）
COLAB_API_KEY="<your-strong-token>" python3 scripts/colab/serve_colab.py \
  --llm-backend llama-cpp \
  --tunnel cloudflared

# 仅打印硬件探测与模型推荐结果，不实际启动服务；或按需跳过单引擎
python3 scripts/colab/serve_colab.py --dry-run
python3 scripts/colab/serve_colab.py --skip-embed --tunnel tailscale
```

常用参数：`--llm-model`、`--llm-alias`、`--embed-model`、`--llm-port`（默认 `8132`）、`--embed-port`（默认 `8133`）、`--tunnel`（`cloudflared` / `tailscale` / `none`）、`--skip-llm`、`--skip-embed`、`--startup-timeout`（默认 `600` 秒）、`--dry-run`。

### 显存自动推荐策略

| GPU 显存档位 | 默认 System-2 模型 (`vllm`) | 量化 / 精度 | 默认上下文长度 |
| --- | --- | --- | --- |
| `>= 70 GB` (A100 80GB) | `Qwen/Qwen2.5-32B-Instruct` | `bfloat16` | `8192` |
| `>= 36 GB` (A100 40GB) | `Qwen/Qwen2.5-14B-Instruct` | `bfloat16` | `8192` |
| `>= 20 GB` (L4 24GB) | `Qwen/Qwen2.5-14B-Instruct-AWQ` | `float16 + awq` | `8192` |
| `>= 14 GB` (T4 16GB) | `Qwen/Qwen2.5-7B-Instruct-AWQ` | `float16 + awq` | `4096` |
| `< 14 GB` / CPU 回退 | `Qwen/Qwen2.5-3B-Instruct` | `float16` / `float32` | `4096` |

---

## 四、隧道安全与成本管控注意事项

1. **强制 Bearer Token 鉴权**：
   - 无论通过 `--api-key` 传入还是未传参自动通过 `secrets.token_urlsafe(24)` 生成，System-2（`8132`）与 `BAAI/bge-m3`（`8133`）的所有 `/v1/*` 接口均强制校验 `Authorization: Bearer <token>`（常数时间比对），未携带或错误凭证统一返回 `401`。
   - 切勿将生成的 Token 或包含运行输出的 `.ipynb` 副本提交至 Git 仓库或截图公开。
   - 「民声智理」服务端落库后不会向前端回传明文密钥（仅返回 `hasApiKey` 与脱敏尾号）。
2. **隧道安全特性**：
   - `cloudflared` Quick Tunnel 每次启动生成一次性随机 `https://*.trycloudflare.com` 域名，仅在脚本运行期间有效，进程退出即失效。
   - 若用于长期团队内部算力共享，建议使用 `--tunnel tailscale` 走 WireGuard 加密内网访问。
3. **用完即释成本管控**：
   - 批量工单研判或演示结束后，务必在终端按 `Ctrl+C`（或在 Colab 中断 Step 4 单元），脚本会自动向所有推理子进程组与隧道进程发送 `SIGTERM`/`SIGKILL`，避免残余进程占用显存。
   - 随后在 Google Colab 点击 **「代码执行程序 → 断开连接并删除运行时 (Disconnect and delete runtime)」** 停止计算单元（CU）计费，并在系统后台 **「算力集群与 Colab GPU」** 面板停用或删除已下线的临时节点。
