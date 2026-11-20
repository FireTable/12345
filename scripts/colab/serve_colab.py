#!/usr/bin/env python3
"""
民声智理 · Colab / Linux GPU 双引擎一键推理启动器 (CivicRadar Colab Worker)

功能说明:
1. 自动探测 NVIDIA GPU 型号与显存 (nvidia-smi)，智能匹配默认 LLM 模型与显存量化参数:
   - A100 80GB+ : Qwen/Qwen2.5-32B-Instruct (bfloat16, ctx=8192)
   - A100 40GB  : Qwen/Qwen2.5-14B-Instruct (bfloat16, ctx=8192)
   - L4 24GB    : Qwen/Qwen2.5-14B-Instruct-AWQ (float16 + awq, ctx=8192)
   - T4 16GB    : Qwen/Qwen2.5-7B-Instruct-AWQ (float16 + awq, ctx=4096)
   - <14GB/CPU  : Qwen/Qwen2.5-3B-Instruct (或 llama-cpp GGUF)
2. 分别拉起两个 100% OpenAI 兼容且强制 Bearer Token 鉴权的推理服务:
   - System-2 认知大模型服务 (默认端口 8132): /v1/models, /v1/chat/completions
   - BAAI/bge-m3 向量嵌入服务 (默认端口 8133): /v1/models, /v1/embeddings (1024 维)
3. 支持三种网络接入方式 (--tunnel):
   - cloudflared : 自动为 8132 / 8133 建立 Cloudflare Quick Tunnel 并提取 HTTPS 公网地址
   - tailscale   : 检查本机 tailscale ip -4，输出内网加密互通地址
   - none        : 仅本地/局域网监听输出
4. 若未传入 --api-key (或环境变量 COLAB_API_KEY)，运行时通过 secrets.token_urlsafe(24) 自动生成高强度 Token。
5. 优雅处理 SIGINT / SIGTERM，退出时自动清理全部子进程组，不留孤儿占用显存。
"""

from __future__ import annotations

import argparse
import asyncio
import hmac
import json
import os
import re
import secrets
import shutil
import signal
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple, Union


DEFAULT_LLM_PORT = 8132
DEFAULT_EMBED_PORT = 8133
DEFAULT_EMBED_MODEL = "BAAI/bge-m3"
TRYCLOUDFLARE_RE = re.compile(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com")


@dataclass(frozen=True)
class GpuInfo:
    index: int
    name: str
    vram_mb: int

    @property
    def vram_gb(self) -> float:
        return self.vram_mb / 1024.0


@dataclass(frozen=True)
class ModelRecommendation:
    tier_label: str
    vllm_model: str
    llama_cpp_model: str
    dtype: str
    quantization: Optional[str]
    max_model_len: int
    gpu_memory_utilization: float
    embed_device: str
    enforce_eager: bool = False


def detect_gpus() -> List[GpuInfo]:
    """通过 nvidia-smi 检测 CUDA GPU 型号与显存 (MB)。"""
    if not shutil.which("nvidia-smi"):
        return []
    try:
        out = subprocess.check_output(
            [
                "nvidia-smi",
                "--query-gpu=index,name,memory.total",
                "--format=csv,noheader,nounits",
            ],
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=5,
        )
    except (subprocess.SubprocessError, OSError):
        return []

    gpus: List[GpuInfo] = []
    for raw_line in out.strip().splitlines():
        line = raw_line.strip()
        if not line:
            continue
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 3:
            continue
        try:
            idx = int(parts[0])
            name = parts[1]
            vram_mb = int(float(parts[2]))
            gpus.append(GpuInfo(index=idx, name=name, vram_mb=vram_mb))
        except ValueError:
            continue
    return gpus


def gpu_supports_bfloat16(gpu_name: str) -> bool:
    """T4 (Turing sm_75) / V100 / P100 等架构不支持原生 bfloat16。"""
    upper = gpu_name.upper()
    legacy_markers = ("T4", "V100", "P100", "P4", "K80", "GTX 10", "GTX 16", "RTX 20")
    return not any(marker in upper for marker in legacy_markers)


def recommend_for_gpu(gpus: Sequence[GpuInfo]) -> ModelRecommendation:
    """根据显存容量与 GPU 架构推荐默认模型和显存参数。"""
    if not gpus:
        return ModelRecommendation(
            tier_label="CPU / 无 CUDA GPU 回退",
            vllm_model="Qwen/Qwen2.5-3B-Instruct",
            llama_cpp_model="Qwen/Qwen2.5-3B-Instruct-GGUF",
            dtype="float32",
            quantization=None,
            max_model_len=4096,
            gpu_memory_utilization=0.65,
            embed_device="cpu",
        )

    primary = gpus[0]
    vram_gb = primary.vram_gb
    bf16_ok = gpu_supports_bfloat16(primary.name)

    if vram_gb >= 70.0:
        return ModelRecommendation(
            tier_label=f"旗舰大显存 ({primary.name}, {vram_gb:.1f} GB)",
            vllm_model="Qwen/Qwen2.5-32B-Instruct",
            llama_cpp_model="Qwen/Qwen2.5-32B-Instruct-GGUF",
            dtype="bfloat16" if bf16_ok else "float16",
            quantization=None,
            max_model_len=8192,
            gpu_memory_utilization=0.85,
            embed_device="cuda",
        )
    if vram_gb >= 36.0:
        return ModelRecommendation(
            tier_label=f"A100 40GB 档 ({primary.name}, {vram_gb:.1f} GB)",
            vllm_model="Qwen/Qwen2.5-14B-Instruct",
            llama_cpp_model="Qwen/Qwen2.5-14B-Instruct-GGUF",
            dtype="bfloat16" if bf16_ok else "float16",
            quantization=None,
            max_model_len=8192,
            gpu_memory_utilization=0.80,
            embed_device="cuda",
        )
    if vram_gb >= 20.0:
        return ModelRecommendation(
            tier_label=f"L4 / 24GB 档 ({primary.name}, {vram_gb:.1f} GB)",
            vllm_model="Qwen/Qwen2.5-14B-Instruct-AWQ",
            llama_cpp_model="Qwen/Qwen2.5-14B-Instruct-GGUF",
            dtype="float16",
            quantization="awq",
            max_model_len=8192,
            gpu_memory_utilization=0.76,
            embed_device="cuda",
        )
    if vram_gb >= 14.0:
        return ModelRecommendation(
            tier_label=f"T4 / 16GB 档 ({primary.name}, {vram_gb:.1f} GB)",
            vllm_model="Qwen/Qwen2.5-7B-Instruct-AWQ",
            llama_cpp_model="Qwen/Qwen2.5-7B-Instruct-GGUF",
            dtype="float16",
            quantization="awq",
            max_model_len=4096,
            gpu_memory_utilization=0.68,
            embed_device="cuda",
            enforce_eager=True,
        )
    return ModelRecommendation(
        tier_label=f"轻量显存档 ({primary.name}, {vram_gb:.1f} GB)",
        vllm_model="Qwen/Qwen2.5-3B-Instruct",
        llama_cpp_model="Qwen/Qwen2.5-3B-Instruct-GGUF",
        dtype="float16",
        quantization=None,
        max_model_len=4096,
        gpu_memory_utilization=0.65,
        embed_device="cpu",
        enforce_eager=True,
    )


def _extract_bearer_token(auth_header: Optional[str]) -> Optional[str]:
    if not auth_header:
        return None
    parts = auth_header.strip().split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    return parts[1].strip()


def _verify_bearer(auth_header: Optional[str], expected_token: str) -> bool:
    provided = _extract_bearer_token(auth_header)
    if not provided:
        return False
    return hmac.compare_digest(provided.encode("utf-8"), expected_token.encode("utf-8"))


# ==============================================================================
# 内置子进程 Worker 1: BAAI/bge-m3 OpenAI 兼容向量嵌入服务 (FastAPI + uvicorn)
# ==============================================================================
def run_embed_server(
    model_name: str,
    host: str,
    port: int,
    api_key: str,
    device: str,
) -> int:
    try:
        import torch
        import uvicorn
        from fastapi import FastAPI, Header, HTTPException
        from pydantic import BaseModel
        from sentence_transformers import SentenceTransformer
    except ImportError as exc:
        print(
            f"[CivicEmbed] 缺少依赖库 ({exc})，请先安装: "
            "pip install sentence-transformers fastapi uvicorn torch",
            file=sys.stderr,
            flush=True,
        )
        return 1

    resolved_device = device
    if resolved_device == "auto":
        resolved_device = "cuda" if torch.cuda.is_available() else "cpu"
    elif resolved_device == "cuda" and not torch.cuda.is_available():
        print("[CivicEmbed] 未检测到可用 CUDA，自动回退 CPU 运行 bge-m3。", flush=True)
        resolved_device = "cpu"

    print(
        f"[CivicEmbed] 正在加载向量模型 {model_name} (device={resolved_device})...",
        flush=True,
    )
    load_kwargs: Dict[str, Any] = {"device": resolved_device}
    if resolved_device.startswith("cuda"):
        load_kwargs["model_kwargs"] = {"torch_dtype": torch.float16}

    try:
        model = SentenceTransformer(model_name, **load_kwargs)
    except TypeError:
        model = SentenceTransformer(model_name, device=resolved_device)

    model_created = int(time.time())
    infer_lock = asyncio.Lock()
    app = FastAPI(title="CivicRadar Colab Embedding Server", version="1.0.0")

    class EmbeddingRequest(BaseModel):
        input: Union[str, List[str]]
        model: Optional[str] = None
        encoding_format: Optional[str] = "float"
        dimensions: Optional[int] = None

    def _check_auth(authorization: Optional[str]) -> None:
        if not _verify_bearer(authorization, api_key):
            raise HTTPException(
                status_code=401,
                detail="Invalid or missing Bearer token",
                headers={"WWW-Authenticate": "Bearer"},
            )

    @app.get("/health")
    async def health() -> Dict[str, Any]:
        return {"status": "ok", "model": model_name, "device": resolved_device}

    @app.get("/v1/models")
    async def list_models(
        authorization: Optional[str] = Header(default=None),
    ) -> Dict[str, Any]:
        _check_auth(authorization)
        return {
            "object": "list",
            "data": [
                {
                    "id": model_name,
                    "object": "model",
                    "created": model_created,
                    "owned_by": "civic-colab",
                }
            ],
        }

    @app.post("/v1/embeddings")
    async def create_embeddings(
        req: EmbeddingRequest,
        authorization: Optional[str] = Header(default=None),
    ) -> Dict[str, Any]:
        _check_auth(authorization)

        if isinstance(req.input, str):
            texts = [req.input]
        elif isinstance(req.input, list):
            texts = [str(item) for item in req.input]
        else:
            raise HTTPException(status_code=400, detail="Field 'input' must be str or list[str]")

        if len(texts) == 0:
            return {
                "object": "list",
                "data": [],
                "model": req.model or model_name,
                "usage": {"prompt_tokens": 0, "total_tokens": 0},
            }

        def _encode_sync(batch_texts: List[str]) -> List[List[float]]:
            vecs = model.encode(
                batch_texts,
                batch_size=32,
                normalize_embeddings=True,
                convert_to_numpy=True,
                show_progress_bar=False,
            )
            if req.dimensions and 0 < req.dimensions < vecs.shape[1]:
                import numpy as np

                sliced = vecs[:, : req.dimensions]
                norms = np.linalg.norm(sliced, axis=1, keepdims=True)
                norms = np.where(norms == 0, 1.0, norms)
                vecs = sliced / norms
            return vecs.astype(float).tolist()

        async with infer_lock:
            vectors = await asyncio.to_thread(_encode_sync, texts)

        prompt_tokens = sum(max(1, len(t) // 2) for t in texts)
        data = [
            {"object": "embedding", "index": idx, "embedding": vec}
            for idx, vec in enumerate(vectors)
        ]
        return {
            "object": "list",
            "data": data,
            "model": req.model or model_name,
            "usage": {"prompt_tokens": prompt_tokens, "total_tokens": prompt_tokens},
        }

    print(
        f"[CivicEmbed] ✅ 向量服务已就绪: http://{host}:{port}/v1 (model={model_name})",
        flush=True,
    )
    uvicorn.run(app, host=host, port=port, log_level="warning")
    return 0


# ==============================================================================
# 内置子进程 Worker 2: llama-cpp-python OpenAI 兼容 LLM 服务 (FastAPI + uvicorn)
# ==============================================================================
def _resolve_gguf_path(model_spec: str) -> Path:
    candidate = Path(model_spec)
    if candidate.is_file():
        return candidate.resolve()

    try:
        from huggingface_hub import hf_hub_download, list_repo_files
    except ImportError as exc:
        raise RuntimeError(
            f"下载 GGUF 模型需要 huggingface_hub ({exc})，请运行: pip install huggingface_hub"
        ) from exc

    if ":" in model_spec:
        repo_id, target_file = model_spec.split(":", 1)
    else:
        repo_id, target_file = model_spec, ""

    files = list(list_repo_files(repo_id))
    ggufs = sorted(f for f in files if f.lower().endswith(".gguf"))
    if not ggufs:
        raise RuntimeError(f"仓库 {repo_id} 中未找到 .gguf 模型文件")

    if target_file:
        matches = [f for f in ggufs if f == target_file or f.endswith(f"/{target_file}")]
        if not matches:
            raise RuntimeError(f"仓库 {repo_id} 中未找到指定文件 {target_file}")
        selected = matches[0]
    else:
        preferred = [f for f in ggufs if "q4_k_m" in f.lower()]
        pool = preferred if preferred else ggufs
        # 若存在分片文件 (*-00001-of-*.gguf)，优先选第一片并下载全部分片
        first_shards = [f for f in pool if re.search(r"-00001-of-\d+\.gguf$", f, re.I)]
        selected = first_shards[0] if first_shards else pool[0]

    shard_match = re.match(r"^(.+)-\d{5}-of-(\d{5})\.gguf$", selected, re.I)
    if shard_match:
        prefix, total_str = shard_match.group(1), shard_match.group(2)
        shard_re = re.compile(
            rf"^{re.escape(prefix)}-\d{{5}}-of-{re.escape(total_str)}\.gguf$", re.I
        )
        shards = sorted(f for f in ggufs if shard_re.match(f))
        downloaded_paths = [Path(hf_hub_download(repo_id=repo_id, filename=s)) for s in shards]
        return downloaded_paths[0].resolve()

    return Path(hf_hub_download(repo_id=repo_id, filename=selected)).resolve()


def run_llama_cpp_server(
    model_spec: str,
    model_alias: str,
    host: str,
    port: int,
    api_key: str,
    n_ctx: int,
) -> int:
    try:
        import uvicorn
        from fastapi import FastAPI, Header, HTTPException
        from fastapi.responses import StreamingResponse
        from llama_cpp import Llama
        from pydantic import BaseModel, ConfigDict
    except ImportError as exc:
        print(
            f"[SystemTwo-LlamaCpp] 缺少依赖库 ({exc})，请先安装: "
            "pip install llama-cpp-python fastapi uvicorn huggingface_hub",
            file=sys.stderr,
            flush=True,
        )
        return 1

    print(f"[SystemTwo-LlamaCpp] 正在准备 GGUF 模型: {model_spec} ...", flush=True)
    try:
        gguf_path = _resolve_gguf_path(model_spec)
    except Exception as exc:
        print(f"[SystemTwo-LlamaCpp] 模型准备失败: {exc}", file=sys.stderr, flush=True)
        return 1

    has_cuda = shutil.which("nvidia-smi") is not None
    n_gpu_layers = -1 if has_cuda else 0
    print(
        f"[SystemTwo-LlamaCpp] 加载 {gguf_path.name} (n_ctx={n_ctx}, n_gpu_layers={n_gpu_layers})...",
        flush=True,
    )
    try:
        llm = Llama(
            model_path=str(gguf_path),
            n_gpu_layers=n_gpu_layers,
            n_ctx=n_ctx,
            flash_attn=has_cuda,
            verbose=False,
        )
    except TypeError:
        llm = Llama(
            model_path=str(gguf_path),
            n_gpu_layers=n_gpu_layers,
            n_ctx=n_ctx,
            verbose=False,
        )

    model_created = int(time.time())
    infer_lock = asyncio.Lock()
    app = FastAPI(title="CivicRadar Colab System-2 (llama-cpp)", version="1.0.0")

    class ChatCompletionRequest(BaseModel):
        model_config = ConfigDict(extra="allow")
        messages: List[Dict[str, Any]]
        model: Optional[str] = None
        temperature: Optional[float] = 0.2
        max_tokens: Optional[int] = 2048
        top_p: Optional[float] = 0.95
        stream: Optional[bool] = False
        response_format: Optional[Dict[str, Any]] = None
        chat_template_kwargs: Optional[Dict[str, Any]] = None

    def _check_auth(authorization: Optional[str]) -> None:
        if not _verify_bearer(authorization, api_key):
            raise HTTPException(
                status_code=401,
                detail="Invalid or missing Bearer token",
                headers={"WWW-Authenticate": "Bearer"},
            )

    @app.get("/health")
    async def health() -> Dict[str, Any]:
        return {"status": "ok", "model": model_alias}

    @app.get("/v1/models")
    async def list_models(
        authorization: Optional[str] = Header(default=None),
    ) -> Dict[str, Any]:
        _check_auth(authorization)
        return {
            "object": "list",
            "data": [
                {
                    "id": model_alias,
                    "object": "model",
                    "created": model_created,
                    "owned_by": "civic-colab",
                }
            ],
        }

    @app.post("/v1/chat/completions")
    async def chat_completions(
        req: ChatCompletionRequest,
        authorization: Optional[str] = Header(default=None),
    ) -> Any:
        _check_auth(authorization)
        kwargs: Dict[str, Any] = {
            "messages": req.messages,
            "temperature": req.temperature if req.temperature is not None else 0.2,
            "max_tokens": req.max_tokens if req.max_tokens is not None else 2048,
            "top_p": req.top_p if req.top_p is not None else 0.95,
            "stream": False,
        }
        if req.response_format:
            kwargs["response_format"] = req.response_format

        if req.stream:
            async def event_stream():
                async with infer_lock:
                    result = await asyncio.to_thread(llm.create_chat_completion, **kwargs)
                choices = result.get("choices", [])
                content = choices[0].get("message", {}).get("content", "") if choices else ""
                chunk = {
                    "id": result.get("id", f"chatcmpl-{int(time.time())}"),
                    "object": "chat.completion.chunk",
                    "created": int(time.time()),
                    "model": req.model or model_alias,
                    "choices": [
                        {
                            "index": 0,
                            "delta": {"role": "assistant", "content": content},
                            "finish_reason": "stop",
                        }
                    ],
                }
                yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"
                yield "data: [DONE]\n\n"

            return StreamingResponse(event_stream(), media_type="text/event-stream")

        t0 = time.perf_counter()
        async with infer_lock:
            result = await asyncio.to_thread(llm.create_chat_completion, **kwargs)
        elapsed_ms = max(1.0, (time.perf_counter() - t0) * 1000.0)

        usage = result.get("usage") or {}
        completion_tokens = int(usage.get("completion_tokens") or 0)
        prompt_tokens = int(usage.get("prompt_tokens") or 0)
        total_tokens = int(usage.get("total_tokens") or (prompt_tokens + completion_tokens))
        tps = (completion_tokens / (elapsed_ms / 1000.0)) if completion_tokens > 0 else 0.0

        return {
            "id": result.get("id", f"chatcmpl-{int(time.time())}"),
            "object": "chat.completion",
            "created": int(time.time()),
            "model": req.model or model_alias,
            "choices": result.get("choices", []),
            "usage": {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": total_tokens,
            },
            "timings": {
                "predicted_n": completion_tokens,
                "predicted_ms": round(elapsed_ms, 2),
                "predicted_per_second": round(tps, 2),
                "prompt_n": prompt_tokens,
            },
        }

    print(
        f"[SystemTwo-LlamaCpp] ✅ LLM 服务已就绪: http://{host}:{port}/v1 (model={model_alias})",
        flush=True,
    )
    uvicorn.run(app, host=host, port=port, log_level="warning")
    return 0


# ==============================================================================
# 主编排器: 进程监控、健康检查、隧道拉起与优雅退出
# ==============================================================================
class ProcessManager:
    def __init__(self) -> None:
        self._procs: List[Tuple[str, subprocess.Popen[Any]]] = []
        self._stopping = False

    def add(self, label: str, proc: subprocess.Popen[Any]) -> None:
        self._procs.append((label, proc))

    def spawn(self, label: str, cmd: Sequence[str], env: Optional[Dict[str, str]] = None) -> subprocess.Popen[Any]:
        kwargs: Dict[str, Any] = {"env": env or os.environ.copy()}
        if os.name == "posix":
            kwargs["start_new_session"] = True
        proc = subprocess.Popen(list(cmd), **kwargs)
        self.add(label, proc)
        return proc

    def terminate_all(self) -> None:
        if self._stopping:
            return
        self._stopping = True
        print("\n🛑 正在停止 Colab 推理子进程与隧道...", flush=True)
        for label, proc in reversed(self._procs):
            if proc.poll() is not None:
                continue
            try:
                if os.name == "posix":
                    os.killpg(proc.pid, signal.SIGTERM)
                else:
                    proc.terminate()
            except OSError:
                pass

        deadline = time.monotonic() + 5.0
        for label, proc in reversed(self._procs):
            remaining = max(0.1, deadline - time.monotonic())
            if proc.poll() is not None:
                continue
            try:
                proc.wait(timeout=remaining)
            except subprocess.TimeoutExpired:
                print(f"⚠️ [{label}] 未能及时退出，发送 SIGKILL...", flush=True)
                try:
                    if os.name == "posix":
                        os.killpg(proc.pid, signal.SIGKILL)
                    else:
                        proc.kill()
                except OSError:
                    pass


def wait_for_http_health(
    url: str,
    proc: subprocess.Popen[Any],
    label: str,
    timeout_sec: int,
) -> bool:
    deadline = time.monotonic() + timeout_sec
    last_log = 0.0
    while time.monotonic() < deadline:
        rc = proc.poll()
        if rc is not None:
            print(f"❌ [{label}] 进程提前退出 (exit code={rc})。", file=sys.stderr, flush=True)
            return False
        try:
            req = urllib.request.Request(url, method="GET")
            with urllib.request.urlopen(req, timeout=2.0) as resp:
                if 200 <= resp.status < 300:
                    return True
        except (urllib.error.URLError, TimeoutError, OSError):
            pass

        now = time.monotonic()
        if now - last_log >= 15.0:
            print(f"⏳ 等待 [{label}] 就绪 ({url})...", flush=True)
            last_log = now
        time.sleep(1.5)

    print(f"❌ 等待 [{label}] 启动超时 ({timeout_sec}s)。", file=sys.stderr, flush=True)
    return False


def start_cloudflared_tunnel(
    pm: ProcessManager,
    label: str,
    local_port: int,
    timeout_sec: int = 30,
) -> Optional[str]:
    cmd = ["cloudflared", "tunnel", "--no-autoupdate", "--url", f"http://127.0.0.1:{local_port}"]
    kwargs: Dict[str, Any] = {
        "stdout": subprocess.PIPE,
        "stderr": subprocess.STDOUT,
        "text": True,
        "bufsize": 1,
    }
    if os.name == "posix":
        kwargs["start_new_session"] = True
    proc = subprocess.Popen(cmd, **kwargs)
    pm.add(f"cloudflared:{label}", proc)

    found_url: List[str] = []
    ready_event = threading.Event()

    def _drain_output() -> None:
        assert proc.stdout is not None
        for line in proc.stdout:
            if not ready_event.is_set():
                match = TRYCLOUDFLARE_RE.search(line)
                if match:
                    found_url.append(match.group(0))
                    ready_event.set()
        proc.stdout.close()

    reader = threading.Thread(target=_drain_output, daemon=True)
    reader.start()

    if not ready_event.wait(timeout=timeout_sec):
        print(f"⚠️ [{label}] cloudflared 未在 {timeout_sec}s 内分配公网 URL。", file=sys.stderr, flush=True)
        return None
    return found_url[0] if found_url else None


def verify_public_endpoint(url_v1: str, api_key: str, timeout_sec: int = 15) -> bool:
    """best-effort 验证公网隧道 /v1/models DNS 与鉴权已可用。"""
    target = f"{url_v1.rstrip('/')}/models"
    deadline = time.monotonic() + timeout_sec
    while time.monotonic() < deadline:
        try:
            req = urllib.request.Request(
                target,
                headers={"Authorization": f"Bearer {api_key}"},
                method="GET",
            )
            with urllib.request.urlopen(req, timeout=3.0) as resp:
                if resp.status == 200:
                    return True
        except (urllib.error.URLError, TimeoutError, OSError):
            time.sleep(1.5)
    return False


def detect_tailscale_ip() -> Optional[str]:
    if not shutil.which("tailscale"):
        return None
    try:
        out = subprocess.check_output(["tailscale", "ip", "-4"], stderr=subprocess.DEVNULL, text=True, timeout=5)
        for line in out.strip().splitlines():
            ip = line.strip()
            if re.match(r"^\d{1,3}(\.\d{1,3}){3}$", ip):
                return ip
    except (subprocess.SubprocessError, OSError):
        pass
    return None


def print_connection_banner(
    gpus: Sequence[GpuInfo],
    llm_enabled: bool,
    embed_enabled: bool,
    llm_model_display: str,
    embed_model: str,
    llm_endpoint_v1: Optional[str],
    embed_endpoint_v1: Optional[str],
    api_key: str,
    tunnel_mode: str,
    llm_backend: str,
) -> None:
    gpu_desc = ", ".join(f"{g.name} ({g.vram_gb:.1f} GB)" for g in gpus) if gpus else "CPU 模式 (未检测到 CUDA GPU)"
    border = "=" * 74
    print(f"\n{border}")
    print("🚀 [民声智理 · Colab GPU 算力节点已就绪]")
    print(border)
    print(f"  • 检测硬件  : {gpu_desc}")
    print(f"  • 推理后端  : {llm_backend} | 隧道模式: {tunnel_mode}")
    print(f"  • Bearer Token (已启用强制鉴权): {api_key}")
    print("-" * 74)
    print("📋 请打开「民声智理后台 → 多站点与算力管理 → 算力集群与 Colab GPU」面板，")
    print("   点击「接入 Colab GPU / 算力节点」，按以下配置热挂载:\n")

    if llm_enabled and llm_endpoint_v1:
        print("  [节点 1: System-2 认知大模型]")
        print("    • 节点角色 (role)     : SYSTEM_TWO")
        print("    • 节点来源 (provider) : COLAB")
        print(f"    • Endpoint URL        : {llm_endpoint_v1}")
        print(f"    • 模型名称 (model)    : {llm_model_display}")
        print(f"    • Bearer Token        : {api_key}\n")

    if embed_enabled and embed_endpoint_v1:
        print("  [节点 2: BAAI/bge-m3 向量嵌入]")
        print("    • 节点角色 (role)     : EMBEDDING")
        print("    • 节点来源 (provider) : COLAB")
        print(f"    • Endpoint URL        : {embed_endpoint_v1}")
        print(f"    • 模型名称 (model)    : {embed_model}")
        print(f"    • Bearer Token        : {api_key}\n")

    print("-" * 74)
    print("💡 用完请按 Ctrl+C (或在 Colab 断开并删除运行时)，释放 GPU 计算资源。")
    print(f"{border}\n", flush=True)


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="民声智理 Colab / Linux GPU 一键启动器 (System-2 LLM + BAAI/bge-m3)"
    )
    parser.add_argument("--llm-model", default=None, help="覆盖自动推荐的 System-2 模型名或 GGUF 路径")
    parser.add_argument("--llm-alias", default=None, help="对外暴露的 served-model-name 别名")
    parser.add_argument("--embed-model", default=DEFAULT_EMBED_MODEL, help="向量嵌入模型 (默认 BAAI/bge-m3)")
    parser.add_argument("--llm-port", type=int, default=DEFAULT_LLM_PORT, help="System-2 服务端口 (默认 8132)")
    parser.add_argument("--embed-port", type=int, default=DEFAULT_EMBED_PORT, help="Embedding 服务端口 (默认 8133)")
    parser.add_argument("--host", default="0.0.0.0", help="监听地址 (默认 0.0.0.0)")
    parser.add_argument(
        "--api-key",
        default=None,
        help="Bearer 鉴权密钥 (未传时读取 COLAB_API_KEY 或自动 secrets.token_urlsafe(24))",
    )
    parser.add_argument(
        "--tunnel",
        choices=["tailscale", "cloudflared", "none"],
        default="none",
        help="公网/内网穿透模式 (tailscale | cloudflared | none)",
    )
    parser.add_argument(
        "--llm-backend",
        choices=["vllm", "llama-cpp"],
        default="vllm",
        help="LLM 推理后端 (vllm | llama-cpp)",
    )
    parser.add_argument("--dtype", choices=["auto", "float16", "bfloat16", "float32"], default=None)
    parser.add_argument("--quantization", default=None, help="vLLM 量化参数 (如 awq / gptq / none)")
    parser.add_argument("--max-model-len", type=int, default=None, help="上下文窗口长度")
    parser.add_argument("--gpu-memory-utilization", type=float, default=None, help="vLLM 显存占用比例")
    parser.add_argument("--embed-device", choices=["auto", "cuda", "cpu"], default="auto", help="bge-m3 运行设备")
    parser.add_argument("--enforce-eager", action="store_true", help="vLLM 启用 eager 模式 (节省显存，T4 默认启用)")
    parser.add_argument("--trust-remote-code", action="store_true", help="vLLM 允许加载自定义仓库代码")
    parser.add_argument("--skip-llm", action="store_true", help="跳过启动 System-2 LLM 服务")
    parser.add_argument("--skip-embed", action="store_true", help="跳过启动 bge-m3 Embedding 服务")
    parser.add_argument("--startup-timeout", type=int, default=600, help="服务就绪超时秒数 (默认 600)")
    parser.add_argument("--dry-run", action="store_true", help="仅打印硬件检测与推荐配置，不实际拉起服务")

    # 内部子进程模式 (保持单脚本自包含)
    parser.add_argument("--internal-embed-server", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--internal-llama-cpp-server", action="store_true", help=argparse.SUPPRESS)
    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = build_arg_parser()
    args = parser.parse_args(argv)

    # 子进程分发
    if args.internal_embed_server:
        if not args.api_key:
            print("Internal embed server requires --api-key", file=sys.stderr)
            return 2
        return run_embed_server(
            model_name=args.embed_model,
            host=args.host,
            port=args.embed_port,
            api_key=args.api_key,
            device=args.embed_device,
        )

    if args.internal_llama_cpp_server:
        if not args.api_key or not args.llm_model:
            print("Internal llama-cpp server requires --api-key and --llm-model", file=sys.stderr)
            return 2
        return run_llama_cpp_server(
            model_spec=args.llm_model,
            model_alias=args.llm_alias or args.llm_model,
            host=args.host,
            port=args.llm_port,
            api_key=args.api_key,
            n_ctx=args.max_model_len or 8192,
        )

    if args.skip_llm and args.skip_embed:
        print("❌ 不能同时指定 --skip-llm 与 --skip-embed。", file=sys.stderr)
        return 2

    # 1. 探测硬件并计算推荐配置
    gpus = detect_gpus()
    rec = recommend_for_gpu(gpus)

    api_key = (
        args.api_key
        or os.environ.get("COLAB_API_KEY", "").strip()
        or os.environ.get("API_KEY", "").strip()
        or secrets.token_urlsafe(24)
    )

    using_default_model = args.llm_model is None
    if args.llm_backend == "vllm":
        llm_model = args.llm_model or rec.vllm_model
    else:
        llm_model = args.llm_model or rec.llama_cpp_model

    llm_alias = args.llm_alias or llm_model
    dtype = args.dtype or rec.dtype
    max_model_len = args.max_model_len or rec.max_model_len
    gpu_mem_util = args.gpu_memory_utilization or rec.gpu_memory_utilization
    embed_device = rec.embed_device if args.embed_device == "auto" else args.embed_device

    if args.quantization is not None:
        quantization: Optional[str] = None if args.quantization.lower() == "none" else args.quantization
    elif using_default_model and args.llm_backend == "vllm":
        quantization = rec.quantization
    elif "awq" in llm_model.lower() and args.llm_backend == "vllm":
        quantization = "awq"
    else:
        quantization = None

    print("==================================================================", flush=True)
    print("🔎 [CivicRadar Colab] 硬件检测与参数规划", flush=True)
    print("==================================================================", flush=True)
    if gpus:
        for g in gpus:
            print(f"  • GPU[{g.index}]: {g.name} | {g.vram_gb:.1f} GB ({g.vram_mb} MB)", flush=True)
    else:
        print("  • 未检测到 NVIDIA GPU (nvidia-smi 不可用)，将按 CPU 回退配置运行", flush=True)
    print(f"  • 推荐档位 : {rec.tier_label}", flush=True)
    if not args.skip_llm:
        print(
            f"  • System-2 : backend={args.llm_backend}, model={llm_model}, "
            f"port={args.llm_port}, dtype={dtype}, quant={quantization or 'none'}, ctx={max_model_len}",
            flush=True,
        )
    if not args.skip_embed:
        print(
            f"  • Embedding: model={args.embed_model}, port={args.embed_port}, device={embed_device}",
            flush=True,
        )
    print(f"  • 隧道模式 : {args.tunnel}", flush=True)

    # 隧道前置检查
    if args.tunnel == "cloudflared" and not args.dry_run and not shutil.which("cloudflared"):
        print(
            "\n❌ 未找到 `cloudflared` 可执行文件。\n"
            "请在 Colab 中安装:\n"
            "  wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb && "
            "dpkg -i cloudflared-linux-amd64.deb",
            file=sys.stderr,
        )
        return 1

    ts_ip: Optional[str] = None
    if args.tunnel == "tailscale":
        ts_ip = detect_tailscale_ip()
        if not ts_ip and not args.dry_run:
            print(
                "\n⚠️ 未检测到已登录的 Tailscale IPv4 (`tailscale ip -4` 失败)。\n"
                "请先安装并登录 Tailscale:\n"
                "  curl -fsSL https://tailscale.com/install.sh | sh && tailscale up\n"
                "将继续启动本地推理服务，请登录后使用 `tailscale ip -4` 替换下方占位地址。\n",
                flush=True,
            )

    # 构造子进程命令
    script_path = str(Path(__file__).resolve())
    embed_cmd = [
        sys.executable,
        script_path,
        "--internal-embed-server",
        "--embed-model",
        args.embed_model,
        "--host",
        args.host,
        "--embed-port",
        str(args.embed_port),
        "--api-key",
        api_key,
        "--embed-device",
        embed_device,
    ]

    if args.llm_backend == "vllm":
        llm_cmd = [
            sys.executable,
            "-m",
            "vllm.entrypoints.openai.api_server",
            "--model",
            llm_model,
            "--served-model-name",
            llm_alias,
            "--host",
            args.host,
            "--port",
            str(args.llm_port),
            "--api-key",
            api_key,
            "--dtype",
            dtype,
            "--gpu-memory-utilization",
            str(gpu_mem_util),
            "--max-model-len",
            str(max_model_len),
        ]
        if quantization:
            llm_cmd.extend(["--quantization", quantization])
        if args.enforce_eager or rec.enforce_eager:
            llm_cmd.append("--enforce-eager")
        if args.trust_remote_code:
            llm_cmd.append("--trust-remote-code")
    else:
        llm_cmd = [
            sys.executable,
            script_path,
            "--internal-llama-cpp-server",
            "--llm-model",
            llm_model,
            "--llm-alias",
            llm_alias,
            "--host",
            args.host,
            "--llm-port",
            str(args.llm_port),
            "--api-key",
            api_key,
            "--max-model-len",
            str(max_model_len),
        ]

    if args.dry_run:
        print("\n[dry-run] 计划执行命令 (Token 已脱敏):")
        if not args.skip_embed:
            print("  Embed:", " ".join("<REDACTED>" if i > 0 and embed_cmd[i - 1] == "--api-key" else a for i, a in enumerate(embed_cmd)))
        if not args.skip_llm:
            print("  LLM  :", " ".join("<REDACTED>" if i > 0 and llm_cmd[i - 1] == "--api-key" else a for i, a in enumerate(llm_cmd)))
        return 0

    pm = ProcessManager()
    stop_event = threading.Event()

    def _handle_signal(signum: int, _frame: Any) -> None:
        stop_event.set()

    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    try:
        embed_proc: Optional[subprocess.Popen[Any]] = None
        llm_proc: Optional[subprocess.Popen[Any]] = None

        # 先拉起 Embedding 服务再拉起 vLLM，避免 vLLM 预占显存后导致 bge-m3 空间不足
        if not args.skip_embed:
            print(f"\n🚀 正在启动向量嵌入服务 (:{args.embed_port})...", flush=True)
            embed_proc = pm.spawn("CivicEmbed", embed_cmd)
            ok = wait_for_http_health(
                f"http://127.0.0.1:{args.embed_port}/health",
                embed_proc,
                "CivicEmbed",
                timeout_sec=min(300, args.startup_timeout),
            )
            if not ok:
                return 1

        if not args.skip_llm:
            print(f"\n🚀 正在启动 System-2 LLM 服务 (:{args.llm_port}, backend={args.llm_backend})...", flush=True)
            llm_proc = pm.spawn("SystemTwo", llm_cmd)
            ok = wait_for_http_health(
                f"http://127.0.0.1:{args.llm_port}/health",
                llm_proc,
                "SystemTwo",
                timeout_sec=args.startup_timeout,
            )
            if not ok:
                return 1

        # 确定对外暴露地址
        llm_endpoint_v1: Optional[str] = None
        embed_endpoint_v1: Optional[str] = None

        if args.tunnel == "cloudflared":
            print("\n🌐 正在创建 Cloudflare Quick Tunnel...", flush=True)
            if not args.skip_llm:
                base = start_cloudflared_tunnel(pm, "system-two", args.llm_port)
                if not base:
                    return 1
                llm_endpoint_v1 = f"{base}/v1"
                verify_public_endpoint(llm_endpoint_v1, api_key)
            if not args.skip_embed:
                base = start_cloudflared_tunnel(pm, "embedding", args.embed_port)
                if not base:
                    return 1
                embed_endpoint_v1 = f"{base}/v1"
                verify_public_endpoint(embed_endpoint_v1, api_key)
        elif args.tunnel == "tailscale":
            host_addr = ts_ip or "<TAILSCALE_IP>"
            if not args.skip_llm:
                llm_endpoint_v1 = f"http://{host_addr}:{args.llm_port}/v1"
            if not args.skip_embed:
                embed_endpoint_v1 = f"http://{host_addr}:{args.embed_port}/v1"
        else:
            host_addr = "127.0.0.1" if args.host in ("0.0.0.0", "::") else args.host
            if not args.skip_llm:
                llm_endpoint_v1 = f"http://{host_addr}:{args.llm_port}/v1"
            if not args.skip_embed:
                embed_endpoint_v1 = f"http://{host_addr}:{args.embed_port}/v1"

        print_connection_banner(
            gpus=gpus,
            llm_enabled=not args.skip_llm,
            embed_enabled=not args.skip_embed,
            llm_model_display=llm_alias,
            embed_model=args.embed_model,
            llm_endpoint_v1=llm_endpoint_v1,
            embed_endpoint_v1=embed_endpoint_v1,
            api_key=api_key,
            tunnel_mode=args.tunnel,
            llm_backend=args.llm_backend,
        )

        # 守护主循环，监控关键进程健康
        while not stop_event.is_set():
            if embed_proc and embed_proc.poll() is not None:
                print(
                    f"❌ [CivicEmbed] 意外退出 (exit code={embed_proc.returncode})。",
                    file=sys.stderr,
                    flush=True,
                )
                return 1
            if llm_proc and llm_proc.poll() is not None:
                print(
                    f"❌ [SystemTwo] 意外退出 (exit code={llm_proc.returncode})。",
                    file=sys.stderr,
                    flush=True,
                )
                return 1
            stop_event.wait(timeout=1.0)

        return 0
    finally:
        pm.terminate_all()


if __name__ == "__main__":
    sys.exit(main())
