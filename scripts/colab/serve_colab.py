#!/usr/bin/env python3
"""
民声智理 · Colab / Linux GPU 双引擎一键推理启动器 (CivicRadar Colab Worker)

功能说明:
1. 默认已对齐 27B Ternary Bonsai 2.5 (ninfer 预编译引擎 + MTP 投机解码, --model-id bonsai-2-27b):
   - A100 80GB+ : Bonsai 2.5 27B PQ2_0 (ctx=65536, kv=131072 rk8v4, conc=4)
   - A100 40GB  : Bonsai 2.5 27B PQ2_0 (ctx=65536, kv=65536 rk8v4, conc=4)
   - L4 24GB    : Bonsai 2.5 27B PQ2_0 (ctx=32768, kv=65536 rk4v4, conc=4)
   - T4 16GB    : Bonsai 2.5 27B PQ2_0 (ctx=32768, kv=32768 rk4v4, conc=2)
   - 可选回退   : --llm-backend vllm / llama-cpp (Qwen2.5 系列或自定义 GGUF)
2. 分别拉起两个 100% OpenAI 兼容且强制 Bearer Token 鉴权的推理服务:
   - System-2 认知大模型服务 (默认端口 8132): /v1/models, /v1/chat/completions
   - BAAI/bge-m3 向量嵌入服务 (默认端口 8133): /v1/models, /v1/embeddings (1024 维)
3. 支持四种网络接入方式 (--tunnel):
   - named       : 使用 Cloudflare Named Tunnel (--token / CIVIC_COLAB_TUNNEL_TOKEN) 暴露固定单域名
                   (默认 civic-colab.firetable.tech: /v1 -> 8132 LLM, /embed/v1 -> 8133 Embedding)
   - cloudflared : 自动为 8132 / 8133 建立 Cloudflare Quick Tunnel 并提取 HTTPS 公网地址
   - tailscale   : 检查本机 tailscale ip -4，输出内网加密互通地址
   - none        : 仅本地/局域网监听输出
4. 若未传入 --api-key (或环境变量 COLAB_API_KEY)，运行时通过 secrets.token_urlsafe(24) 自动生成高强度 Token。
5. 优雅处理 SIGINT / SIGTERM，退出时自动清理全部子进程组，不留孤儿占用显存。
"""

import argparse
import asyncio
from collections import deque
import hashlib
import hmac
import json
import os
import queue as std_queue
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
DEFAULT_PUBLIC_HOST = "civic-colab.firetable.tech"
DEFAULT_NINFER_REPO = "WaveCut/Ternary-Bonsai-2.5-27B-PQ2_0-NInfer-v3"
DEFAULT_NINFER_FILE = "Ternary-Bonsai-2.5-27B-PQ2_0-ninfer-v3.ninfer"
DEFAULT_NINFER_ALIAS = "bonsai-2-27b"
NINFER_RELEASE_API = "https://api.github.com/repos/iamwavecut/ninfer-all/releases"
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
    ninfer_supported: bool = True
    ninfer_model: str = f"{DEFAULT_NINFER_REPO}:{DEFAULT_NINFER_FILE}"
    ninfer_alias: str = DEFAULT_NINFER_ALIAS
    ninfer_max_context: int = 32768
    ninfer_kv_capacity: int = 32768
    ninfer_kv_dtype: str = "rk4v4"
    ninfer_max_concurrency: int = 2
    ninfer_host_cache_mib: int = 1024


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


def detect_cuda_driver_version() -> Optional[Tuple[int, int]]:
    """从 nvidia-smi 顶部输出解析驱动支持的最高 CUDA 版本，如 (13, 0)。"""
    if not shutil.which("nvidia-smi"):
        return None
    try:
        out = subprocess.check_output(["nvidia-smi"], stderr=subprocess.DEVNULL, text=True, timeout=5)
    except (subprocess.SubprocessError, OSError):
        return None
    match = re.search(r"CUDA Version:\s*(\d+)\.(\d+)", out)
    if not match:
        return None
    return (int(match.group(1)), int(match.group(2)))


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
            ninfer_supported=False,
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
            ninfer_supported=True,
            ninfer_max_context=65536,
            ninfer_kv_capacity=131072,
            ninfer_kv_dtype="rk8v4",
            ninfer_max_concurrency=4,
            ninfer_host_cache_mib=4096,
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
            ninfer_supported=True,
            ninfer_max_context=65536,
            ninfer_kv_capacity=65536,
            ninfer_kv_dtype="rk8v4",
            ninfer_max_concurrency=4,
            ninfer_host_cache_mib=2048,
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
            ninfer_supported=True,
            ninfer_max_context=32768,
            ninfer_kv_capacity=65536,
            ninfer_kv_dtype="rk4v4",
            ninfer_max_concurrency=4,
            ninfer_host_cache_mib=2048,
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
            ninfer_supported=True,
            ninfer_max_context=32768,
            ninfer_kv_capacity=32768,
            ninfer_kv_dtype="rk4v4",
            ninfer_max_concurrency=2,
            ninfer_host_cache_mib=1024,
        )
    if vram_gb >= 10.0:
        return ModelRecommendation(
            tier_label=f"12GB 显存档 ({primary.name}, {vram_gb:.1f} GB)",
            vllm_model="Qwen/Qwen2.5-3B-Instruct",
            llama_cpp_model="Qwen/Qwen2.5-3B-Instruct-GGUF",
            dtype="float16",
            quantization=None,
            max_model_len=4096,
            gpu_memory_utilization=0.65,
            embed_device="cuda",
            enforce_eager=True,
            ninfer_supported=True,
            ninfer_max_context=32768,
            ninfer_kv_capacity=32768,
            ninfer_kv_dtype="rk4v4",
            ninfer_max_concurrency=2,
            ninfer_host_cache_mib=1024,
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
        ninfer_supported=False,
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
    @app.get("/embed/health")
    async def health() -> Dict[str, Any]:
        return {"status": "ok", "model": model_name, "device": resolved_device}

    @app.get("/v1/models")
    @app.get("/embed/v1/models")
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
    @app.post("/embed/v1/embeddings")
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
                loop = asyncio.get_running_loop()
                chunk_queue: asyncio.Queue[Optional[Tuple[str, Any]]] = asyncio.Queue()
                stop_sentinel = False

                def _produce() -> None:
                    try:
                        stream_iter = llm.create_chat_completion(**{**kwargs, "stream": True})
                        for raw_chunk in stream_iter:
                            loop.call_soon_threadsafe(chunk_queue.put_nowait, ("chunk", raw_chunk))
                    except Exception as exc:
                        loop.call_soon_threadsafe(chunk_queue.put_nowait, ("err", str(exc)))
                    finally:
                        loop.call_soon_threadsafe(chunk_queue.put_nowait, None)

                async with infer_lock:
                    producer = threading.Thread(target=_produce, daemon=True)
                    producer.start()
                    while not stop_sentinel:
                        item = await chunk_queue.get()
                        if item is None:
                            stop_sentinel = True
                            break
                        kind, payload = item
                        if kind == "err":
                            err_chunk = {
                                "error": {"message": payload, "type": "server_error"},
                            }
                            yield f"data: {json.dumps(err_chunk, ensure_ascii=False)}\n\n"
                            break
                        if isinstance(payload, dict) and "model" not in payload:
                            payload["model"] = req.model or model_alias
                        yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
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
# NInfer 预编译二进制与 Ternary Bonsai 2.5 27B 权重自动准备
# ==============================================================================
def default_ninfer_cache_dir() -> Path:
    if Path("/content").is_dir():
        return Path("/content/civic-ninfer")
    return Path.home() / ".cache" / "civic-ninfer"


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(8 * 1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _parse_sha256sums(text: str) -> Dict[str, str]:
    sums: Dict[str, str] = {}
    for raw_line in text.splitlines():
        parts = raw_line.strip().split()
        if len(parts) >= 2:
            filename = parts[1].lstrip("*")
            sums[filename] = parts[0].lower()
            sums[Path(filename).name] = parts[0].lower()
    return sums


def _download_file(url: str, dest: Path, label: str) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(f".{dest.name}.part")
    if shutil.which("curl"):
        print(f"[NInfer] 正在下载 {label} ...", flush=True)
        cmd = ["curl", "-fsSL", "--retry", "3", "-o", str(tmp), url]
        if tmp.exists():
            cmd = ["curl", "-fsSL", "-C", "-", "--retry", "3", "-o", str(tmp), url]
        subprocess.check_call(cmd)
        tmp.replace(dest)
        return

    print(f"[NInfer] 正在下载 {label} (urllib)...", flush=True)
    req = urllib.request.Request(url, headers={"User-Agent": "civic-colab-worker"})
    with urllib.request.urlopen(req, timeout=120) as resp, open(tmp, "wb") as out:
        shutil.copyfileobj(resp, out, length=4 * 1024 * 1024)
    tmp.replace(dest)


def ensure_ninfer_binary(
    cache_dir: Path,
    release_tag: str,
    cuda_ver: Optional[Tuple[int, int]],
    explicit_bin: Optional[str] = None,
) -> Path:
    """定位或自动下载 SHA256 校验通过的 Linux ninfer-serve 二进制。"""
    if explicit_bin:
        cand = Path(explicit_bin).expanduser()
        if not cand.is_file():
            raise FileNotFoundError(f"指定的 --ninfer-bin 不存在: {cand}")
        return cand.resolve()

    if sys.platform != "linux":
        raise RuntimeError(f"自动下载仅支持 Linux x64，当前平台为 {sys.platform}，请通过 --ninfer-bin 指定本地可执行文件。")

    pkg_prefix = (
        "ninfer-linux-x64-cuda13.4-sm75-80-86-89-120a-"
        if cuda_ver is not None and cuda_ver >= (13, 4)
        else "ninfer-linux-x64-cuda12.9-sm70-75-80-86-89-"
    )
    tag_key = release_tag.strip() or "latest"
    api_url = (
        f"{NINFER_RELEASE_API}/latest"
        if tag_key == "latest"
        else f"{NINFER_RELEASE_API}/tags/{tag_key}"
    )

    engine_root = cache_dir / "engine"
    if tag_key != "latest":
        cached_dir = engine_root / tag_key
        if cached_dir.is_dir():
            for p in cached_dir.rglob("ninfer-serve"):
                if p.is_file() and pkg_prefix.rstrip("-") in str(p):
                    return p.resolve()

    req = urllib.request.Request(api_url, headers={"Accept": "application/vnd.github+json", "User-Agent": "civic-colab-worker"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        release = json.loads(resp.read().decode("utf-8"))

    resolved_tag = str(release.get("tag_name") or tag_key)
    target_dir = engine_root / resolved_tag
    if target_dir.is_dir():
        for p in target_dir.rglob("ninfer-serve"):
            if p.is_file() and pkg_prefix.rstrip("-") in str(p):
                os.chmod(p, 0o755)
                print(f"[NInfer] 复用已缓存引擎 ({resolved_tag}): {p}", flush=True)
                return p.resolve()

    assets = {a["name"]: a["browser_download_url"] for a in release.get("assets", [])}
    part_names = sorted(
        n for n in assets if n.startswith(pkg_prefix) and re.search(r"\.tar\.gz\.\d{3}$", n)
    )
    sum_names = sorted(
        n for n in assets if n.startswith(f"SHA256SUMS-{pkg_prefix}")
    )
    if not part_names or not sum_names:
        raise RuntimeError(f"Release {resolved_tag} 中未找到匹配的 {pkg_prefix}* 发布包。")

    dl_dir = cache_dir / "downloads" / resolved_tag
    dl_dir.mkdir(parents=True, exist_ok=True)
    sum_path = dl_dir / sum_names[0]
    _download_file(assets[sum_names[0]], sum_path, sum_names[0])
    expected_sums = _parse_sha256sums(sum_path.read_text(encoding="utf-8"))

    part_paths: List[Path] = []
    for pname in part_names:
        pdest = dl_dir / pname
        expected = expected_sums.get(pname)
        if pdest.is_file() and expected and _sha256_file(pdest) == expected:
            print(f"[NInfer] 复用已校验压缩分片: {pname}", flush=True)
        else:
            _download_file(assets[pname], pdest, pname)
            if expected:
                actual = _sha256_file(pdest)
                if actual != expected:
                    pdest.unlink(missing_ok=True)
                    raise RuntimeError(f"{pname} SHA256 校验失败: {actual} != {expected}")
        part_paths.append(pdest)

    staging_dir = engine_root / f".staging-{resolved_tag}-{os.getpid()}"
    if staging_dir.exists():
        shutil.rmtree(staging_dir, ignore_errors=True)
    staging_dir.mkdir(parents=True, exist_ok=True)

    print(f"[NInfer] 正在解压 {resolved_tag} ({pkg_prefix.rstrip('-')})...", flush=True)
    try:
        proc = subprocess.Popen(
            ["tar", "-xzf", "-", "-C", str(staging_dir)],
            stdin=subprocess.PIPE,
        )
        assert proc.stdin is not None
        for ppath in part_paths:
            with open(ppath, "rb") as pf:
                while True:
                    buf = pf.read(4 * 1024 * 1024)
                    if not buf:
                        break
                    proc.stdin.write(buf)
        proc.stdin.close()
        rc = proc.wait()
        if rc != 0:
            raise RuntimeError(f"tar 解压失败 (exit code={rc})")

        target_dir.parent.mkdir(parents=True, exist_ok=True)
        if target_dir.exists():
            shutil.rmtree(target_dir, ignore_errors=True)
        staging_dir.rename(target_dir)
    except Exception:
        shutil.rmtree(staging_dir, ignore_errors=True)
        raise

    for p in target_dir.rglob("ninfer-serve"):
        if p.is_file():
            os.chmod(p, 0o755)
            print(f"[NInfer] ✅ 引擎已就绪: {p}", flush=True)
            return p.resolve()

    raise RuntimeError(f"解压 {resolved_tag} 后未找到 ninfer-serve 可执行文件。")


def ensure_ninfer_model(model_spec: str, cache_dir: Path) -> Path:
    """定位或从 HuggingFace 自动下载并校验 .ninfer 模型文件。"""
    cand = Path(model_spec).expanduser()
    if cand.is_file():
        return cand.resolve()

    os.environ["HF_HUB_DISABLE_XET"] = "1"
    if ":" in model_spec:
        repo_id, target_file = model_spec.split(":", 1)
    elif model_spec == DEFAULT_NINFER_REPO:
        repo_id, target_file = model_spec, DEFAULT_NINFER_FILE
    else:
        repo_id, target_file = model_spec, ""

    try:
        from huggingface_hub import hf_hub_download, list_repo_files
    except ImportError:
        hf_hub_download = None
        list_repo_files = None

    if not target_file:
        if list_repo_files is None:
            raise RuntimeError("解析默认 .ninfer 文件需要 huggingface_hub，或直接传入 repo_id:filename。")
        files = sorted(f for f in list_repo_files(repo_id) if f.lower().endswith(".ninfer"))
        if not files:
            raise RuntimeError(f"仓库 {repo_id} 中未找到 .ninfer 权重文件。")
        target_file = files[0]

    expected_sha: Optional[str] = None
    try:
        if hf_hub_download is not None:
            sum_file = Path(hf_hub_download(repo_id=repo_id, filename="SHA256SUMS"))
            expected_sha = _parse_sha256sums(sum_file.read_text(encoding="utf-8")).get(Path(target_file).name)
        else:
            sum_url = f"https://huggingface.co/{repo_id}/resolve/main/SHA256SUMS"
            with urllib.request.urlopen(sum_url, timeout=15) as resp:
                expected_sha = _parse_sha256sums(resp.read().decode("utf-8")).get(Path(target_file).name)
    except Exception:
        expected_sha = None

    print(f"[NInfer] 正在准备 Bonsai 2.5 权重 {repo_id}/{target_file} ...", flush=True)
    local_dest = cache_dir / "models" / Path(target_file).name
    if hf_hub_download is not None:
        downloaded = Path(hf_hub_download(repo_id=repo_id, filename=target_file))
        resolved_blob = downloaded.resolve()
        if resolved_blob.suffix.lower() == ".ninfer":
            model_path = resolved_blob
        else:
            # huggingface_hub snapshots 指向无后缀 blob，ninfer-serve 要求路径扩展名为 .ninfer，
            # 优先同分区零拷贝硬链接为真实 .ninfer 文件（跨分区回退符号链接）。
            local_dest.parent.mkdir(parents=True, exist_ok=True)
            if local_dest.exists() or local_dest.is_symlink():
                if local_dest.is_symlink() or local_dest.stat().st_ino != resolved_blob.stat().st_ino:
                    local_dest.unlink()
            if not local_dest.exists():
                try:
                    os.link(resolved_blob, local_dest)
                except OSError:
                    os.symlink(resolved_blob, local_dest)
            model_path = local_dest
    else:
        if not (local_dest.is_file() and expected_sha and _sha256_file(local_dest) == expected_sha):
            _download_file(
                f"https://huggingface.co/{repo_id}/resolve/main/{target_file}",
                local_dest,
                Path(target_file).name,
            )
        model_path = local_dest.resolve()

    if expected_sha:
        actual_sha = _sha256_file(model_path)
        if actual_sha != expected_sha:
            raise RuntimeError(f"{model_path.name} SHA256 校验失败: {actual_sha} != {expected_sha}")
        print(f"[NInfer] ✅ 权重校验通过: {model_path.name} ({actual_sha[:12]}...)", flush=True)
    return model_path


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
    api_key: Optional[str] = None,
) -> bool:
    deadline = time.monotonic() + timeout_sec
    last_log = 0.0
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    while time.monotonic() < deadline:
        rc = proc.poll()
        if rc is not None:
            print(f"❌ [{label}] 进程提前退出 (exit code={rc})。", file=sys.stderr, flush=True)
            return False
        try:
            req = urllib.request.Request(url, headers=headers, method="GET")
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


def start_named_cloudflared_tunnel(
    pm: ProcessManager,
    tunnel_token: str,
    startup_grace_sec: float = 3.0,
) -> Optional[subprocess.Popen[Any]]:
    """启动 Cloudflare Named Tunnel (`cloudflared tunnel --no-autoupdate run --token ...`)。"""
    cmd = ["cloudflared", "tunnel", "--no-autoupdate", "run", "--token", tunnel_token]
    kwargs: Dict[str, Any] = {
        "stdout": subprocess.PIPE,
        "stderr": subprocess.STDOUT,
        "text": True,
        "bufsize": 1,
    }
    if os.name == "posix":
        kwargs["start_new_session"] = True
    proc = subprocess.Popen(cmd, **kwargs)
    pm.add("cloudflared:named", proc)

    recent_logs: deque[str] = deque(maxlen=20)

    def _drain_output() -> None:
        assert proc.stdout is not None
        try:
            for line in proc.stdout:
                cleaned = line.rstrip()
                if cleaned:
                    if tunnel_token:
                        cleaned = cleaned.replace(tunnel_token, "<REDACTED>")
                    recent_logs.append(cleaned)
        finally:
            proc.stdout.close()

    reader = threading.Thread(target=_drain_output, daemon=True)
    reader.start()

    deadline = time.monotonic() + startup_grace_sec
    while time.monotonic() < deadline:
        rc = proc.poll()
        if rc is not None:
            reader.join(timeout=1.0)
            print(f"❌ cloudflared Named Tunnel 提前退出 (exit code={rc})。", file=sys.stderr, flush=True)
            for tail in recent_logs:
                print(f"  [cloudflared] {tail}", file=sys.stderr, flush=True)
            return None
        time.sleep(0.25)

    return proc


def _write_status_file(status_path: Path, payload: Dict[str, Any]) -> None:
    """以 0600 权限原子写入运行时状态 JSON 文件。"""
    status_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = status_path.with_name(f".{status_path.name}.{os.getpid()}.tmp")
    fd = os.open(str(tmp_path), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False, indent=2)
            fh.write("\n")
        os.chmod(tmp_path, 0o600)
        tmp_path.replace(status_path)
    except Exception:
        tmp_path.unlink(missing_ok=True)
        raise


def verify_public_endpoint(url_v1: str, api_key: str, timeout_sec: int = 20) -> bool:
    """best-effort 验证公网隧道 /v1/models DNS 与鉴权已可用。"""
    target = f"{url_v1.rstrip('/')}/models"
    deadline = time.monotonic() + timeout_sec
    while time.monotonic() < deadline:
        try:
            req = urllib.request.Request(
                target,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "User-Agent": "civic-colab-worker",
                },
                method="GET",
            )
            with urllib.request.urlopen(req, timeout=4.0) as resp:
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
        description="民声智理 Colab / Linux GPU 一键启动器 (默认 Bonsai 2.5 27B + BAAI/bge-m3)"
    )
    parser.add_argument("--llm-model", default=None, help="覆盖 System-2 模型名、HF repo:file 或本地 .ninfer/.gguf 路径")
    parser.add_argument("--llm-alias", default=None, help="对外暴露的模型 ID（ninfer 默认 bonsai-2-27b）")
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
        choices=["tailscale", "cloudflared", "named", "none"],
        default="none",
        help="公网/内网穿透模式 (tailscale | cloudflared | named | none)",
    )
    parser.add_argument(
        "--tunnel-token",
        default=None,
        help="Cloudflare Named Tunnel Token (未传时读取 CIVIC_COLAB_TUNNEL_TOKEN 或 COLAB_TUNNEL_TOKEN)",
    )
    parser.add_argument(
        "--public-host",
        default=None,
        help=f"Named Tunnel 公网域名 (未传时读取 CIVIC_COLAB_HOSTNAME 或默认 {DEFAULT_PUBLIC_HOST})",
    )
    parser.add_argument(
        "--llm-backend",
        choices=["ninfer", "vllm", "llama-cpp"],
        default="ninfer",
        help="LLM 推理后端 (默认 ninfer 运行 Bonsai 2.5 27B; 可选 vllm | llama-cpp)",
    )
    parser.add_argument("--ninfer-bin", default=None, help="指定已安装的 ninfer-serve 可执行文件路径")
    parser.add_argument("--ninfer-cache-dir", default=None, help="ninfer 引擎与模型缓存目录")
    parser.add_argument("--ninfer-release", default="latest", help="iamwavecut/ninfer-all 发布 tag (默认 latest)")
    parser.add_argument("--max-concurrency", type=int, default=None, help="ninfer 最大连续批处理并发度 (1..8)")
    parser.add_argument("--kv-capacity", type=int, default=None, help="ninfer 共享 KV 容量 (tokens)")
    parser.add_argument("--kv-dtype", default=None, help="ninfer KV 量化格式 (如 rk4v4 / rk8v4)")
    parser.add_argument("--host-cache-mib", type=int, default=None, help="ninfer Host 内存缓存预算 (MiB)")
    parser.add_argument("--no-mtp", action="store_true", help="ninfer 关闭 MTP 投机解码")
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
    parser.add_argument("--status-file", default=None, help="服务就绪后写入 JSON 状态文件路径 (0600 权限)")
    parser.add_argument("--dry-run", action="store_true", help="仅打印硬件检测与推荐配置，不实际下载与拉起服务")

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
    cuda_ver = detect_cuda_driver_version()
    rec = recommend_for_gpu(gpus)

    api_key = (
        args.api_key
        or os.environ.get("CIVIC_COLAB_API_KEY", "").strip()
        or os.environ.get("COLAB_API_KEY", "").strip()
        or os.environ.get("API_KEY", "").strip()
        or secrets.token_urlsafe(24)
    )
    tunnel_token = (
        (args.tunnel_token or "").strip()
        or os.environ.get("CIVIC_COLAB_TUNNEL_TOKEN", "").strip()
        or os.environ.get("COLAB_TUNNEL_TOKEN", "").strip()
        or None
    )
    raw_public_host = (
        (args.public_host or "").strip()
        or os.environ.get("CIVIC_COLAB_HOSTNAME", "").strip()
        or DEFAULT_PUBLIC_HOST
    )
    public_host = (
        re.sub(r"^https?://", "", raw_public_host, flags=re.IGNORECASE).split("/", 1)[0].strip()
        or DEFAULT_PUBLIC_HOST
    )

    using_default_model = args.llm_model is None
    if args.llm_backend == "ninfer":
        llm_model = args.llm_model or rec.ninfer_model
        llm_alias = args.llm_alias or rec.ninfer_alias
        max_model_len = args.max_model_len or rec.ninfer_max_context
    elif args.llm_backend == "vllm":
        llm_model = args.llm_model or rec.vllm_model
        llm_alias = args.llm_alias or llm_model
        max_model_len = args.max_model_len or rec.max_model_len
    else:
        llm_model = args.llm_model or rec.llama_cpp_model
        llm_alias = args.llm_alias or llm_model
        max_model_len = args.max_model_len or rec.max_model_len

    kv_capacity = max(args.kv_capacity or rec.ninfer_kv_capacity, max_model_len)
    kv_dtype = args.kv_dtype or rec.ninfer_kv_dtype
    max_concurrency = args.max_concurrency or rec.ninfer_max_concurrency
    host_cache_mib = args.host_cache_mib if args.host_cache_mib is not None else rec.ninfer_host_cache_mib
    dtype = args.dtype or rec.dtype
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
            cuda_str = f" | CUDA Driver {cuda_ver[0]}.{cuda_ver[1]}" if cuda_ver else ""
            print(f"  • GPU[{g.index}]: {g.name} | {g.vram_gb:.1f} GB ({g.vram_mb} MB){cuda_str}", flush=True)
    else:
        print("  • 未检测到 NVIDIA GPU (nvidia-smi 不可用)，将按 CPU 回退配置运行", flush=True)
    print(f"  • 推荐档位 : {rec.tier_label}", flush=True)
    if not args.skip_llm:
        if args.llm_backend == "ninfer":
            mtp_str = "off" if args.no_mtp else "mtp(draft=3,lm-head)"
            print(
                f"  • System-2 : backend=ninfer, model={llm_model}, alias={llm_alias}, "
                f"port={args.llm_port}, ctx={max_model_len}, kv={kv_capacity}({kv_dtype}), "
                f"conc={max_concurrency}, spec={mtp_str}",
                flush=True,
            )
        else:
            print(
                f"  • System-2 : backend={args.llm_backend}, model={llm_model}, alias={llm_alias}, "
                f"port={args.llm_port}, dtype={dtype}, quant={quantization or 'none'}, ctx={max_model_len}",
                flush=True,
            )
    if not args.skip_embed:
        print(
            f"  • Embedding: model={args.embed_model}, port={args.embed_port}, device={embed_device}",
            flush=True,
        )
    tunnel_note = f" ({public_host})" if args.tunnel == "named" else ""
    print(f"  • 隧道模式 : {args.tunnel}{tunnel_note}", flush=True)

    if args.llm_backend == "ninfer" and not args.skip_llm and not args.dry_run and not rec.ninfer_supported:
        print(
            "\n❌ `ninfer` 后端需要 >= 10GB 显存的 NVIDIA CUDA GPU（如 T4 16GB / L4 24GB / A100）。\n"
            "请在 Colab 菜单开启 GPU 运行时，或使用 `--llm-backend llama-cpp` 回退模式。",
            file=sys.stderr,
        )
        return 1

    # 隧道前置检查
    if args.tunnel in ("cloudflared", "named") and not args.dry_run and not shutil.which("cloudflared"):
        print(
            "\n❌ 未找到 `cloudflared` 可执行文件。\n"
            "请在 Colab 中安装:\n"
            "  wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb && "
            "dpkg -i cloudflared-linux-amd64.deb",
            file=sys.stderr,
        )
        return 1

    if args.tunnel == "named" and not args.dry_run and not tunnel_token:
        print(
            "\n❌ `--tunnel named` 需要传入 `--tunnel-token` 或设置环境变量 `CIVIC_COLAB_TUNNEL_TOKEN` / `COLAB_TUNNEL_TOKEN`。",
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

    cache_dir = Path(args.ninfer_cache_dir).expanduser() if args.ninfer_cache_dir else default_ninfer_cache_dir()

    def _build_ninfer_cmd(bin_path: str, model_path: str) -> List[str]:
        cmd = [
            bin_path,
            model_path,
            "--host",
            args.host,
            "--port",
            str(args.llm_port),
            "--model-id",
            llm_alias,
            "--api-key",
            api_key,
            "--structured-output",
            "--max-context",
            str(max_model_len),
            "--kv-capacity",
            str(kv_capacity),
            "--kv-dtype",
            kv_dtype,
            "--host-cache-mib",
            str(host_cache_mib),
            "--gdn-state-fp16",
            "--max-concurrency",
            str(max_concurrency),
            "--default-reasoning-effort",
            "none",
            "--min-p",
            "0",
            "--presence-penalty",
            "0",
            "--temperature",
            "0.1",
            "--top-p",
            "0.9",
            "--top-k",
            "20",
        ]
        if not args.no_mtp:
            cmd.extend(["--spec", "mtp", "--draft-tokens", "3", "--lm-head-draft"])
        return cmd

    if args.llm_backend == "ninfer":
        if args.dry_run or args.skip_llm:
            preview_bin = args.ninfer_bin or "<auto-download:ninfer-serve>"
            preview_model = llm_model if Path(llm_model).is_file() else f"<auto-download:{DEFAULT_NINFER_FILE}>"
            llm_cmd = _build_ninfer_cmd(preview_bin, preview_model)
        else:
            ninfer_bin = ensure_ninfer_binary(
                cache_dir=cache_dir,
                release_tag=args.ninfer_release,
                cuda_ver=cuda_ver,
                explicit_bin=args.ninfer_bin,
            )
            ninfer_model_path = ensure_ninfer_model(llm_model, cache_dir=cache_dir)
            llm_cmd = _build_ninfer_cmd(str(ninfer_bin), str(ninfer_model_path))
    elif args.llm_backend == "vllm":
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
            print("  Embed :", " ".join("<REDACTED>" if i > 0 and embed_cmd[i - 1] == "--api-key" else a for i, a in enumerate(embed_cmd)))
        if not args.skip_llm:
            print("  LLM   :", " ".join("<REDACTED>" if i > 0 and llm_cmd[i - 1] == "--api-key" else a for i, a in enumerate(llm_cmd)))
        if args.tunnel == "named":
            tunnel_cmd = ["cloudflared", "tunnel", "--no-autoupdate", "run", "--token", tunnel_token or "<CIVIC_COLAB_TUNNEL_TOKEN>"]
            print(
                "  Tunnel:",
                " ".join("<REDACTED>" if i > 0 and tunnel_cmd[i - 1] == "--token" else a for i, a in enumerate(tunnel_cmd)),
                f"(llm=https://{public_host}/v1, embed=https://{public_host}/embed/v1)",
            )
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
        tunnel_proc: Optional[subprocess.Popen[Any]] = None

        # 先拉起 Embedding 服务再拉起 System-2 LLM，避免大显存预占后导致 bge-m3 空间不足
        if not args.skip_embed:
            print(f"\n🚀 正在启动向量嵌入服务 (:{args.embed_port})...", flush=True)
            embed_proc = pm.spawn("CivicEmbed", embed_cmd)
            ok = wait_for_http_health(
                f"http://127.0.0.1:{args.embed_port}/health",
                embed_proc,
                "CivicEmbed",
                timeout_sec=min(300, args.startup_timeout),
                api_key=api_key,
            )
            if not ok:
                return 1

        if not args.skip_llm:
            print(f"\n🚀 正在启动 System-2 LLM 服务 (:{args.llm_port}, backend={args.llm_backend})...", flush=True)
            llm_proc = pm.spawn("SystemTwo", llm_cmd)
            health_path = "/v1/models" if args.llm_backend == "ninfer" else "/health"
            ok = wait_for_http_health(
                f"http://127.0.0.1:{args.llm_port}{health_path}",
                llm_proc,
                "SystemTwo",
                timeout_sec=args.startup_timeout,
                api_key=api_key,
            )
            if not ok:
                return 1

        # 确定对外暴露地址
        llm_endpoint_v1: Optional[str] = None
        embed_endpoint_v1: Optional[str] = None

        if args.tunnel == "named":
            print(f"\n🌐 正在启动 Cloudflare Named Tunnel ({public_host})...", flush=True)
            assert tunnel_token is not None
            tunnel_proc = start_named_cloudflared_tunnel(pm, tunnel_token)
            if not tunnel_proc:
                return 1
            if not args.skip_llm:
                llm_endpoint_v1 = f"https://{public_host}/v1"
                if verify_public_endpoint(llm_endpoint_v1, api_key, timeout_sec=45):
                    print(f"  ✅ LLM 公网端点已就绪: {llm_endpoint_v1}", flush=True)
                else:
                    print(
                        f"  ⚠️ LLM 公网端点在 45s 内尚未通过边缘探测 ({llm_endpoint_v1})，请稍后重试或检查 Tunnel 路由。",
                        flush=True,
                    )
            if not args.skip_embed:
                embed_endpoint_v1 = f"https://{public_host}/embed/v1"
                if verify_public_endpoint(embed_endpoint_v1, api_key, timeout_sec=45):
                    print(f"  ✅ Embed 公网端点已就绪: {embed_endpoint_v1}", flush=True)
                else:
                    print(
                        f"  ⚠️ Embed 公网端点在 45s 内尚未通过边缘探测 ({embed_endpoint_v1})，请稍后重试或检查 Tunnel 路由。",
                        flush=True,
                    )
        elif args.tunnel == "cloudflared":
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

        if args.status_file:
            _write_status_file(
                Path(args.status_file).expanduser(),
                {
                    "ready": True,
                    "llm_url": llm_endpoint_v1,
                    "embed_url": embed_endpoint_v1,
                    "llm_model": llm_alias if not args.skip_llm else None,
                    "embed_model": args.embed_model if not args.skip_embed else None,
                    "llm_backend": args.llm_backend,
                    "tunnel": args.tunnel,
                    "tunnel_mode": args.tunnel,
                    "public_host": public_host if args.tunnel == "named" else None,
                    "token": api_key,
                    "pid": os.getpid(),
                    "pgid": os.getpgrp() if hasattr(os, "getpgrp") else os.getpid(),
                    "gpus": [{"index": g.index, "name": g.name, "vram_mb": g.vram_mb} for g in gpus],
                    "updated_at": int(time.time()),
                },
            )

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
            if tunnel_proc and tunnel_proc.poll() is not None:
                print(
                    f"❌ [Cloudflared] Named Tunnel 意外退出 (exit code={tunnel_proc.returncode})。",
                    file=sys.stderr,
                    flush=True,
                )
                return 1
            stop_event.wait(timeout=1.0)

        return 0
    finally:
        if args.status_file:
            try:
                Path(args.status_file).expanduser().unlink(missing_ok=True)
            except OSError:
                pass
        pm.terminate_all()


if __name__ == "__main__":
    sys.exit(main())
