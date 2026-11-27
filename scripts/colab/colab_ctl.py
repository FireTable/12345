#!/usr/bin/env python3
"""
民声智理 · Google Colab 算力会话全生命周期控制器 (CivicRadar Colab Control)

使用 Google Colab CLI (`colab`) 与 Python 3 标准库在本地宿主机一键编排 Colab GPU 会话:
  - up     : 分配 GPU 会话，上传 serve_colab.py，在 VM 内以独立进程组启动推理服务与隧道并轮询日志
  - status : 查看会话状态、远端 GPU nvidia-smi 显存与隧道就绪信息（脱敏 Token）
  - test   : 从宿主机执行完整 E2E 校验（未鉴权 401 / 模型列表 200 / 中文流式对话 TTFT & tok/s / 1024维向量 / VRAM）
  - stop   : 优雅终止远端服务进程组、销毁 Colab 会话并通过 `colab sessions` 核验已释放

安全与稳定性约束:
  1. 仅操作目标 `--session`（默认 `civic-colab-gpu`），绝不触碰其他无关会话。
  2. 不在单个 `colab exec` 中阻塞 pip/模型下载；一律在 VM 内脱离会话后台运行，宿主机短轮询（30s 超时重试）。
  3. 仅使用 Python 3 标准库 + `$PATH` 上的 `colab` CLI，不依赖宿主机第三方 pip 包。
  4. 任何日志/标准输出默认将 Token 脱敏为 `****xxxx`；仅 `up --show-token` 时打印一次原始 Token。
"""

import argparse
import base64
import json
import math
import os
import re
import secrets
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple


DEFAULT_SESSION = "civic-colab-gpu"
DEFAULT_GPU = "L4"
DEFAULT_PUBLIC_HOST = "civic-colab.firetable.tech"
GPU_CHOICES = ("L4", "T4", "A100", "H100", "G4")
TUNNEL_CHOICES = ("auto", "named", "cloudflared", "tailscale", "none")
BACKEND_CHOICES = ("ninfer", "vllm", "llama-cpp")

REPO_ROOT = Path(__file__).resolve().parents[2]
LOCAL_SERVE_SCRIPT = Path(__file__).resolve().parent / "serve_colab.py"
CACHE_DIR = Path.home() / ".cache" / "civic-colab"
AGENTS_ENV_FILE = Path.home() / ".agents" / ".env"

REMOTE_SERVE_PATH = "/content/serve_colab.py"
REMOTE_START_SCRIPT = "/tmp/civic_colab_start.sh"
REMOTE_ENV_FILE = "/tmp/civic_colab.env"
REMOTE_SECRETS_FILE = "/tmp/civic_colab_secrets.env"
REMOTE_LOG_FILE = "/tmp/civic_colab.log"
REMOTE_CFG_FILE = "/tmp/civic_colab_cfg.json"
REMOTE_PID_FILE = "/tmp/civic_colab.pid"
REMOTE_EXIT_FILE = "/tmp/civic_colab.exit"

EXEC_BEGIN_MARKER = "__CIVIC_EXEC_BEGIN__"
EXEC_OK_MARKER = "__CIVIC_EXEC_OK__"
EXEC_ERR_MARKER = "__CIVIC_EXEC_ERR__"

ANSI_ESCAPE_RE = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
SESSION_LINE_RE = re.compile(r"^\[([^\]]+)\]\s+(\S+)\s*\|\s*(.+)$")
CHINESE_CHAR_RE = re.compile(r"[\u4e00-\u9fff]")


def _parse_env_file(path: Path) -> Dict[str, str]:
    parsed: Dict[str, str] = {}
    if not path.is_file():
        return parsed
    try:
        raw_text = path.read_text(encoding="utf-8")
    except OSError:
        return parsed
    for raw_line in raw_text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].strip()
        if "=" not in line:
            continue
        key, val = line.split("=", 1)
        key = key.strip()
        val = val.strip()
        if len(val) >= 2 and ((val[0] == '"' and val[-1] == '"') or (val[0] == "'" and val[-1] == "'")):
            val = val[1:-1]
        if key:
            parsed[key] = val
    return parsed


def normalize_public_host(raw_host: Optional[str]) -> str:
    cleaned = (raw_host or "").strip()
    cleaned = re.sub(r"^https?://", "", cleaned, flags=re.IGNORECASE)
    cleaned = cleaned.split("/", 1)[0].strip()
    return cleaned or DEFAULT_PUBLIC_HOST


def load_civic_colab_env() -> Dict[str, str]:
    """在内存中按 环境变量 > 仓库 .env.local > 仓库 .env > ~/.agents/.env 优先级读取 Colab 隧道与鉴权配置（绝不打印原始密钥）。"""
    env_layers = [
        _parse_env_file(REPO_ROOT / ".env.local"),
        _parse_env_file(REPO_ROOT / ".env"),
        _parse_env_file(AGENTS_ENV_FILE),
    ]

    def _get(keys: Sequence[str], default: str = "") -> str:
        for k in keys:
            val = os.environ.get(k, "").strip()
            if val:
                return val
        for layer in env_layers:
            for k in keys:
                val = layer.get(k, "").strip()
                if val:
                    return val
        return default

    return {
        "tunnel_token": _get(("CIVIC_COLAB_TUNNEL_TOKEN", "COLAB_TUNNEL_TOKEN")),
        "api_key": _get(("CIVIC_COLAB_API_KEY", "COLAB_API_KEY")),
        "hostname": normalize_public_host(_get(("CIVIC_COLAB_HOSTNAME",), DEFAULT_PUBLIC_HOST)),
    }


def mask_token(token: Optional[str]) -> str:
    if not token:
        return "<none>"
    if len(token) <= 4:
        return "****"
    return f"****{token[-4:]}"


def redact_text(
    text: str,
    known_token: Optional[str] = None,
    extra_secrets: Optional[Sequence[Optional[str]]] = None,
) -> str:
    if not text:
        return text
    masked = text
    secrets_to_mask: List[str] = []
    if known_token:
        secrets_to_mask.append(known_token)
    if extra_secrets:
        for item in extra_secrets:
            if item and item not in secrets_to_mask:
                secrets_to_mask.append(item)
    for sec in secrets_to_mask:
        masked = masked.replace(sec, mask_token(sec))
    masked = re.sub(
        r"(Bearer\s+)([A-Za-z0-9._~+/=-]{6,})",
        lambda m: f"{m.group(1)}{mask_token(m.group(2))}",
        masked,
    )
    masked = re.sub(
        r"(Bearer Token[^:\n]*:\s*)(\S+)",
        lambda m: f"{m.group(1)}{mask_token(m.group(2))}",
        masked,
    )
    masked = re.sub(
        r"((?:CIVIC_)?COLAB_(?:API_KEY|TUNNEL_TOKEN)=)([^\s\"']+)",
        lambda m: f"{m.group(1)}{mask_token(m.group(2))}",
        masked,
    )
    masked = re.sub(
        r"(--token(?:=|\s+))([^\s\"']+)",
        lambda m: f"{m.group(1)}<REDACTED>",
        masked,
    )
    return masked


def strip_colab_chatter(text: str) -> str:
    lines: List[str] = []
    for raw_line in ANSI_ESCAPE_RE.sub("", text).splitlines():
        stripped = raw_line.strip()
        if (
            stripped.startswith("[colab] A new version of Colab CLI is available:")
            or stripped.startswith("[colab] Run 'colab update'")
            or stripped.startswith("[colab] To silence this check,")
        ):
            continue
        lines.append(raw_line)
    return "\n".join(lines).strip()


def require_colab_cli() -> str:
    colab_bin = shutil.which("colab")
    if not colab_bin:
        raise RuntimeError(
            "未在 $PATH 中找到 `colab` CLI。请先安装 google-colab-cli 并完成认证（如 `uv tool install google-colab-cli`）。"
        )
    return colab_bin


def run_colab_cmd(
    args: Sequence[str],
    *,
    stdin_text: Optional[str] = None,
    timeout: int = 30,
    retries: int = 2,
    retry_delay: float = 2.0,
) -> subprocess.CompletedProcess[str]:
    require_colab_cli()
    cmd = ["colab", *args]
    last_exc: Optional[Exception] = None
    last_proc: Optional[subprocess.CompletedProcess[str]] = None

    for attempt in range(retries + 1):
        try:
            proc = subprocess.run(
                cmd,
                input=stdin_text,
                text=True,
                capture_output=True,
                timeout=timeout,
            )
            if proc.returncode == 0:
                return proc
            last_proc = proc
        except subprocess.TimeoutExpired as exc:
            last_exc = exc
        if attempt < retries:
            time.sleep(retry_delay)

    if last_exc is not None:
        raise RuntimeError(f"命令超时 (>{timeout}s): {' '.join(cmd)}") from last_exc
    assert last_proc is not None
    detail = strip_colab_chatter((last_proc.stderr or "") + "\n" + (last_proc.stdout or ""))
    raise RuntimeError(
        f"命令执行失败 (exit={last_proc.returncode}): {' '.join(cmd)}\n{redact_text(detail)}"
    )


def colab_exec_marked(
    session: str,
    body_py: str,
    *,
    timeout: int = 30,
    kernel_timeout: float = 20.0,
    retries: int = 2,
) -> str:
    """在远端 Colab 内核执行 Python 代码并通过显式标记检查异常（colab exec 异常时仍可能返回 exit 0）。"""
    indented = "\n".join(f"    {line}" if line else "" for line in body_py.splitlines())
    wrapped = (
        "import traceback as _civic_tb\n"
        f"print({EXEC_BEGIN_MARKER!r}, flush=True)\n"
        "try:\n"
        f"{indented}\n"
        f"    print({EXEC_OK_MARKER!r}, flush=True)\n"
        "except Exception:\n"
        f"    print({EXEC_ERR_MARKER!r}, flush=True)\n"
        "    _civic_tb.print_exc()\n"
    )
    proc = run_colab_cmd(
        ["exec", "-s", session, "--timeout", str(kernel_timeout)],
        stdin_text=wrapped,
        timeout=timeout,
        retries=retries,
    )
    combined = strip_colab_chatter((proc.stdout or "") + "\n" + (proc.stderr or ""))
    if EXEC_ERR_MARKER in combined or "Traceback (most recent call last):" in combined:
        raise RuntimeError(f"远端 Colab 内核执行异常:\n{redact_text(combined)}")
    if EXEC_BEGIN_MARKER not in combined or EXEC_OK_MARKER not in combined:
        raise RuntimeError(f"远端 Colab 内核输出不完整:\n{redact_text(combined)}")
    start_idx = combined.index(EXEC_BEGIN_MARKER) + len(EXEC_BEGIN_MARKER)
    end_idx = combined.index(EXEC_OK_MARKER, start_idx)
    return combined[start_idx:end_idx].strip()


def list_colab_sessions() -> List[Dict[str, str]]:
    proc = run_colab_cmd(["sessions"], timeout=30, retries=2)
    cleaned = strip_colab_chatter((proc.stdout or "") + "\n" + (proc.stderr or ""))
    sessions: List[Dict[str, str]] = []
    for line in cleaned.splitlines():
        s = line.strip()
        if not s or "[colab] No active sessions found" in s:
            continue
        match = SESSION_LINE_RE.match(s)
        if match:
            sessions.append(
                {
                    "name": match.group(1),
                    "endpoint": match.group(2),
                    "detail": match.group(3),
                    "raw": s,
                }
            )
    return sessions


def session_exists(session: str) -> bool:
    return any(item["name"] == session for item in list_colab_sessions())


def create_secret_temp_file(suffix: str = ".json") -> Path:
    fd, path_str = tempfile.mkstemp(prefix="civic-colab-", suffix=suffix)
    os.close(fd)
    os.chmod(path_str, 0o600)
    return Path(path_str)


def cache_path_for(session: str) -> Path:
    safe_name = re.sub(r"[^A-Za-z0-9_.-]+", "_", session)
    return CACHE_DIR / f"{safe_name}.json"


def save_local_cache(session: str, data: Dict[str, Any]) -> Path:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    os.chmod(CACHE_DIR, 0o700)
    dest = cache_path_for(session)
    fd, tmp_str = tempfile.mkstemp(prefix=f".{dest.name}.", dir=str(CACHE_DIR))
    tmp_path = Path(tmp_str)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)
            fh.write("\n")
        os.chmod(tmp_path, 0o600)
        tmp_path.replace(dest)
        os.chmod(dest, 0o600)
    except Exception:
        tmp_path.unlink(missing_ok=True)
        raise
    return dest


def load_local_cache(session: str) -> Optional[Dict[str, Any]]:
    path = cache_path_for(session)
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def download_remote_cfg(session: str) -> Optional[Dict[str, Any]]:
    """通过 `colab download` 将远端配置下载至 0600 临时文件解析并在 finally 中清理。"""
    tmp_path = create_secret_temp_file(".json")
    try:
        try:
            proc = subprocess.run(
                ["colab", "download", "-s", session, REMOTE_CFG_FILE, str(tmp_path)],
                text=True,
                capture_output=True,
                timeout=30,
            )
        except subprocess.TimeoutExpired:
            proc = None

        if proc is not None and proc.returncode == 0 and tmp_path.is_file() and tmp_path.stat().st_size > 0:
            os.chmod(tmp_path, 0o600)
            return json.loads(tmp_path.read_text(encoding="utf-8"))

        # 若 Jupyter Contents API 对 /tmp 路径受限，回退通过短 exec 读取并写入同一 0600 临时文件
        out = colab_exec_marked(
            session,
            f"""
import base64
from pathlib import Path
p = Path({REMOTE_CFG_FILE!r})
if p.is_file():
    print("B64:" + base64.b64encode(p.read_bytes()).decode("ascii"))
else:
    print("MISSING")
""",
            timeout=30,
            kernel_timeout=20.0,
            retries=1,
        )
        for line in out.splitlines():
            if line.startswith("B64:"):
                raw = base64.b64decode(line[4:].strip())
                tmp_path.write_bytes(raw)
                os.chmod(tmp_path, 0o600)
                return json.loads(tmp_path.read_text(encoding="utf-8"))
        return None
    finally:
        tmp_path.unlink(missing_ok=True)


def query_remote_nvidia_smi(session: str) -> str:
    out = colab_exec_marked(
        session,
        """
import shutil, subprocess
if not shutil.which("nvidia-smi"):
    print("nvidia-smi unavailable")
else:
    r = subprocess.run(["nvidia-smi"], text=True, capture_output=True, timeout=10)
    print(r.stdout.strip() or r.stderr.strip())
""",
        timeout=30,
        kernel_timeout=20.0,
        retries=1,
    )
    return out


def build_remote_start_script(
    args: argparse.Namespace,
    *,
    effective_tunnel: str,
    public_host: str,
) -> str:
    extra_py_pkgs: List[str] = []
    if args.llm_backend == "vllm":
        extra_py_pkgs.append("vllm")
    elif args.llm_backend == "llama-cpp":
        extra_py_pkgs.append("llama-cpp-python")

    serve_cmd_parts = [
        "python3",
        "-u",
        REMOTE_SERVE_PATH,
        "--tunnel",
        effective_tunnel,
        "--llm-backend",
        args.llm_backend,
        "--startup-timeout",
        str(args.startup_timeout),
        "--status-file",
        REMOTE_CFG_FILE,
    ]
    if effective_tunnel == "named":
        serve_cmd_parts.extend(["--public-host", public_host])
    if args.llm_model:
        serve_cmd_parts.extend(["--llm-model", args.llm_model])
    if args.max_concurrency is not None:
        serve_cmd_parts.extend(["--max-concurrency", str(args.max_concurrency)])
    if args.kv_capacity is not None:
        serve_cmd_parts.extend(["--kv-capacity", str(args.kv_capacity)])
    if args.skip_embed:
        serve_cmd_parts.append("--skip-embed")
    if args.skip_llm:
        serve_cmd_parts.append("--skip-llm")

    serve_cmd_str = " ".join(shlex.quote(p) for p in serve_cmd_parts)
    extra_pkgs_json = json.dumps(extra_py_pkgs)

    cloudflared_block = ""
    if effective_tunnel in ("cloudflared", "named"):
        cloudflared_block = """
if ! command -v cloudflared >/dev/null 2>&1; then
  echo "[Bootstrap] Installing cloudflared quietly..."
  if curl -fsSL --retry 3 -o /usr/local/bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64; then
    chmod 755 /usr/local/bin/cloudflared
  else
    curl -fsSL --retry 3 -o /tmp/cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
    dpkg -i /tmp/cloudflared.deb >/dev/null 2>&1
    rm -f /tmp/cloudflared.deb
  fi
fi
"""

    return f"""#!/usr/bin/env bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
export PIP_DISABLE_PIP_VERSION_CHECK=1
export HF_HUB_DISABLE_XET=1
export HF_HUB_DISABLE_PROGRESS_BARS=1
export TQDM_DISABLE=1
export PYTHONUNBUFFERED=1

if [ -f {shlex.quote(REMOTE_ENV_FILE)} ]; then
  set -a
  source {shlex.quote(REMOTE_ENV_FILE)}
  set +a
fi

if [ -f {shlex.quote(REMOTE_SECRETS_FILE)} ]; then
  set -a
  source {shlex.quote(REMOTE_SECRETS_FILE)}
  set +a
fi

echo "[Bootstrap] Checking GPU & CUDA driver..."
if command -v nvidia-smi >/dev/null 2>&1; then
  nvidia-smi --query-gpu=index,name,memory.total --format=csv,noheader || true
  CUDA_VER=$(nvidia-smi | sed -n 's/.*CUDA Version: \\([0-9][0-9]*\\.[0-9][0-9]*\\).*/\\1/p' | head -n 1 || true)
  echo "[Bootstrap] CUDA Driver Version: ${{CUDA_VER:-unknown}}"
else
  echo "[Bootstrap] WARNING: nvidia-smi not found"
fi

MISSING_PKGS=$(python3 - <<'PY'
import importlib.util

checks = [
    ("sentence_transformers", "sentence-transformers"),
    ("fastapi", "fastapi"),
    ("uvicorn", "uvicorn"),
    ("huggingface_hub", "huggingface_hub"),
    ("pydantic", "pydantic"),
]
extra = {extra_pkgs_json}
for pkg in extra:
    mod = "llama_cpp" if pkg == "llama-cpp-python" else pkg
    checks.append((mod, pkg))

missing = [pip_name for mod_name, pip_name in checks if importlib.util.find_spec(mod_name) is None]
print(" ".join(missing))
PY
)

if [ -n "$MISSING_PKGS" ]; then
  echo "[Bootstrap] Installing Python deps: $MISSING_PKGS"
  if command -v uv >/dev/null 2>&1; then
    uv pip install --system -q --no-progress $MISSING_PKGS
  else
    python3 -m pip install -q --no-input --progress-bar off $MISSING_PKGS
  fi
else
  echo "[Bootstrap] Python deps already satisfied."
fi
{cloudflared_block}
rm -f {shlex.quote(REMOTE_CFG_FILE)} {shlex.quote(REMOTE_EXIT_FILE)}

echo "[Bootstrap] Launching serve_colab.py..."
set +e
{serve_cmd_str}
RC=$?
echo "$RC" > {shlex.quote(REMOTE_EXIT_FILE)}
exit "$RC"
"""


def launch_remote_detached(
    session: str,
    token: str,
    start_script: str,
    *,
    tunnel_token: Optional[str] = None,
) -> int:
    env_content = (
        "HF_HUB_DISABLE_XET=1\n"
        "HF_HUB_DISABLE_PROGRESS_BARS=1\n"
        "TQDM_DISABLE=1\n"
        "PYTHONUNBUFFERED=1\n"
    )
    secret_lines = [
        f"COLAB_API_KEY={shlex.quote(token)}",
        f"CIVIC_COLAB_API_KEY={shlex.quote(token)}",
    ]
    if tunnel_token:
        secret_lines.append(f"CIVIC_COLAB_TUNNEL_TOKEN={shlex.quote(tunnel_token)}")
    secrets_content = "\n".join(secret_lines) + "\n"

    env_b64 = base64.b64encode(env_content.encode("utf-8")).decode("ascii")
    secrets_b64 = base64.b64encode(secrets_content.encode("utf-8")).decode("ascii")
    script_b64 = base64.b64encode(start_script.encode("utf-8")).decode("ascii")

    out = colab_exec_marked(
        session,
        f"""
import base64, os, subprocess
from pathlib import Path

for p in ({REMOTE_CFG_FILE!r}, {REMOTE_EXIT_FILE!r}, {REMOTE_PID_FILE!r}, {REMOTE_LOG_FILE!r}, {REMOTE_SECRETS_FILE!r}):
    try:
        os.unlink(p)
    except FileNotFoundError:
        pass

def _write_0600(path_str: str, data_b64: str) -> None:
    fd = os.open(path_str, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as fh:
        fh.write(base64.b64decode(data_b64))
    os.chmod(path_str, 0o600)

_write_0600({REMOTE_ENV_FILE!r}, {env_b64!r})
_write_0600({REMOTE_SECRETS_FILE!r}, {secrets_b64!r})

sh_path = Path({REMOTE_START_SCRIPT!r})
sh_path.write_bytes(base64.b64decode({script_b64!r}))
os.chmod(sh_path, 0o700)

log_fh = open({REMOTE_LOG_FILE!r}, "ab", buffering=0)
proc = subprocess.Popen(
    ["bash", str(sh_path)],
    stdin=subprocess.DEVNULL,
    stdout=log_fh,
    stderr=subprocess.STDOUT,
    start_new_session=True,
    close_fds=True,
)
log_fh.close()
Path({REMOTE_PID_FILE!r}).write_text(str(proc.pid), encoding="utf-8")
print(f"SPAWNED_PID={{proc.pid}}")
""",
        timeout=30,
        kernel_timeout=20.0,
        retries=2,
    )
    for line in out.splitlines():
        if line.startswith("SPAWNED_PID="):
            return int(line.split("=", 1)[1].strip())
    raise RuntimeError(
        f"未能获取后台进程 PID:\n{redact_text(out, token, extra_secrets=[tunnel_token])}"
    )


def poll_remote_startup(
    session: str,
    remote_pid: int,
    token: str,
    timeout_sec: int,
    *,
    tunnel_token: Optional[str] = None,
) -> None:
    deadline = time.monotonic() + timeout_sec
    log_offset = 0
    consecutive_errors = 0

    while time.monotonic() < deadline:
        poll_py = f"""
import json, os
from pathlib import Path

offset = {log_offset}
log_path = Path({REMOTE_LOG_FILE!r})
new_text = ""
next_offset = offset
if log_path.is_file():
    size = log_path.stat().st_size
    if size > offset:
        with open(log_path, "rb") as fh:
            fh.seek(offset)
            chunk = fh.read(32768)
        next_offset = offset + len(chunk)
        new_text = chunk.decode("utf-8", errors="replace")

cfg_ready = False
cfg_path = Path({REMOTE_CFG_FILE!r})
if cfg_path.is_file():
    try:
        cfg_ready = bool(json.loads(cfg_path.read_text(encoding="utf-8")).get("ready"))
    except Exception:
        cfg_ready = False

exit_code = None
exit_path = Path({REMOTE_EXIT_FILE!r})
if exit_path.is_file():
    try:
        exit_code = int(exit_path.read_text(encoding="utf-8").strip())
    except Exception:
        exit_code = -1

alive = False
try:
    os.kill({remote_pid}, 0)
    alive = True
except OSError:
    alive = False

print(json.dumps({{
    "new_text": new_text,
    "next_offset": next_offset,
    "cfg_ready": cfg_ready,
    "exit_code": exit_code,
    "alive": alive,
}}))
"""
        try:
            raw = colab_exec_marked(session, poll_py, timeout=30, kernel_timeout=20.0, retries=1)
            consecutive_errors = 0
            data = json.loads(raw.splitlines()[-1])
        except Exception as exc:
            consecutive_errors += 1
            if consecutive_errors >= 5:
                raise RuntimeError(f"连续 {consecutive_errors} 次轮询 Colab 状态失败: {exc}") from exc
            time.sleep(3.0)
            continue

        log_offset = int(data.get("next_offset", log_offset))
        new_text = data.get("new_text") or ""
        if new_text:
            for line in new_text.splitlines():
                print(
                    f"  [remote] {redact_text(line, token, extra_secrets=[tunnel_token])}",
                    flush=True,
                )

        if data.get("cfg_ready"):
            return

        exit_code = data.get("exit_code")
        alive = bool(data.get("alive"))
        if exit_code is not None or (not alive and not data.get("cfg_ready")):
            raise RuntimeError(f"远端 serve_colab.py 提前退出 (exit_code={exit_code})")

        time.sleep(4.0)

    raise RuntimeError(f"等待 Colab 服务就绪超时 ({timeout_sec}s)")


def check_remote_service_alive(session: str) -> Tuple[bool, Optional[int]]:
    out = colab_exec_marked(
        session,
        f"""
import json, os
from pathlib import Path

pid = None
pid_path = Path({REMOTE_PID_FILE!r})
if pid_path.is_file():
    try:
        pid = int(pid_path.read_text(encoding="utf-8").strip())
    except Exception:
        pid = None

alive = False
if pid is not None:
    try:
        os.kill(pid, 0)
        alive = True
    except OSError:
        alive = False

cfg_ready = False
cfg_path = Path({REMOTE_CFG_FILE!r})
if cfg_path.is_file():
    try:
        cfg_ready = bool(json.loads(cfg_path.read_text(encoding="utf-8")).get("ready"))
    except Exception:
        cfg_ready = False

print(json.dumps({{"alive": alive, "pid": pid, "cfg_ready": cfg_ready}}))
""",
        timeout=30,
        kernel_timeout=20.0,
        retries=1,
    )
    info = json.loads(out.splitlines()[-1])
    return bool(info.get("alive") and info.get("cfg_ready")), info.get("pid")


def stop_remote_processes(session: str) -> None:
    """尽最大努力优雅终止远端 serve_colab.py 进程组，不影响其他会话。"""
    try:
        colab_exec_marked(
            session,
            f"""
import json, os, signal, subprocess, time
from pathlib import Path

pids = set()
for path_str in ({REMOTE_PID_FILE!r},):
    p = Path(path_str)
    if p.is_file():
        try:
            pids.add(int(p.read_text(encoding="utf-8").strip()))
        except Exception:
            pass

cfg_p = Path({REMOTE_CFG_FILE!r})
if cfg_p.is_file():
    try:
        cfg = json.loads(cfg_p.read_text(encoding="utf-8"))
        for k in ("pid", "pgid"):
            if isinstance(cfg.get(k), int):
                pids.add(cfg[k])
    except Exception:
        pass

for pid in sorted(pids):
    try:
        pgid = os.getpgid(pid)
        os.killpg(pgid, signal.SIGTERM)
    except OSError:
        try:
            os.kill(pid, signal.SIGTERM)
        except OSError:
            pass

subprocess.run(["pkill", "-TERM", "-f", "serve_colab.py|ninfer-serve|cloudflared"], stderr=subprocess.DEVNULL)
time.sleep(2.0)

for pid in sorted(pids):
    try:
        pgid = os.getpgid(pid)
        os.killpg(pgid, signal.SIGKILL)
    except OSError:
        try:
            os.kill(pid, signal.SIGKILL)
        except OSError:
            pass

for p in ({REMOTE_CFG_FILE!r}, {REMOTE_PID_FILE!r}, {REMOTE_ENV_FILE!r}, {REMOTE_SECRETS_FILE!r}):
    try:
        os.unlink(p)
    except FileNotFoundError:
        pass
""",
            timeout=25,
            kernel_timeout=15.0,
            retries=0,
        )
    except Exception:
        # 会话可能已不可达或已断开，继续执行 colab stop
        pass


def stop_session(session: str) -> None:
    print(f"🛑 正在停止 Colab 会话 '{session}' ...", flush=True)
    if session_exists(session):
        stop_remote_processes(session)

    # 始终仅对目标 session 执行 colab stop -s <session>
    run_colab_cmd(["stop", "-s", session], timeout=60, retries=2)

    # 通过 colab sessions 确认目标会话已彻底消失
    for attempt in range(3):
        if not session_exists(session):
            print(f"✅ 已确认 Colab 会话 '{session}' 从 `colab sessions` 移除，停止计费。", flush=True)
            return
        if attempt < 2:
            time.sleep(2.0)
            run_colab_cmd(["stop", "-s", session], timeout=60, retries=1)

    raise RuntimeError(f"终止校验失败: `colab sessions` 中仍存在会话 '{session}'！")


def print_session_summary(
    session: str,
    cfg: Dict[str, Any],
    *,
    show_token: bool = False,
    cache_file: Optional[Path] = None,
) -> None:
    token = str(cfg.get("token") or "")
    token_display = token if show_token else mask_token(token)
    tunnel_mode = cfg.get("tunnel_mode") or cfg.get("tunnel")
    print("\n==================================================================", flush=True)
    print(f"🚀 Colab 会话 '{session}' 已就绪", flush=True)
    print("==================================================================", flush=True)
    print(f"  • 推理后端  : {cfg.get('llm_backend')} | 隧道: {tunnel_mode}", flush=True)
    if cfg.get("public_host"):
        print(f"  • 固定域名  : {cfg.get('public_host')}", flush=True)
    if cfg.get("llm_url"):
        print(f"  • LLM URL   : {cfg.get('llm_url')} (model={cfg.get('llm_model')})", flush=True)
    if cfg.get("embed_url"):
        print(f"  • Embed URL : {cfg.get('embed_url')} (model={cfg.get('embed_model')})", flush=True)
    print(f"  • Token     : {token_display}", flush=True)
    if cache_file is not None:
        print(f"  • 本地缓存  : {cache_file} (0600)", flush=True)
    print("==================================================================\n", flush=True)


def http_json_request(
    url: str,
    *,
    method: str = "GET",
    token: Optional[str] = None,
    payload: Optional[Dict[str, Any]] = None,
    timeout: float = 20.0,
) -> Tuple[int, Dict[str, Any]]:
    headers: Dict[str, str] = {
        "Accept": "application/json",
        "User-Agent": "CivicRadar-ColabCtl/1.0",
    }
    data: Optional[bytes] = None
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if payload is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            return resp.status, (json.loads(raw) if raw.strip() else {})
    except urllib.error.HTTPError as err:
        raw = err.read().decode("utf-8", errors="replace")
        parsed: Dict[str, Any] = {}
        if raw.strip():
            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError:
                parsed = {"raw": raw[:400]}
        return err.code, parsed


def assert_unauth_401(endpoint_v1: str, label: str, propagation_timeout: float = 20.0) -> None:
    target = f"{endpoint_v1.rstrip('/')}/models"
    target_path = urllib.parse.urlparse(target).path or "/v1/models"
    deadline = time.monotonic() + propagation_timeout
    last_err: Optional[str] = None

    while time.monotonic() < deadline:
        try:
            status, body = http_json_request(target, method="GET", token=None, timeout=8.0)
            if status == 401:
                print(f"  ✅ [{label}] 未鉴权 GET {target_path} -> HTTP 401", flush=True)
                return
            if status in (530, 502, 503):
                last_err = f"HTTP {status}"
                time.sleep(1.5)
                continue
            raise AssertionError(
                f"[{label}] 期望未鉴权返回 HTTP 401，实际得到 HTTP {status}: {body}"
            )
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last_err = str(exc)
            time.sleep(1.5)

    raise AssertionError(f"[{label}] 在 {propagation_timeout:.0f}s 内未收到 HTTP 401 ({last_err})")


def assert_auth_models(endpoint_v1: str, token: str, expected_model: str, label: str) -> List[str]:
    target = f"{endpoint_v1.rstrip('/')}/models"
    target_path = urllib.parse.urlparse(target).path or "/v1/models"
    status, body = http_json_request(target, method="GET", token=token, timeout=20.0)
    if status != 200:
        raise AssertionError(f"[{label}] 鉴权 GET {target_path} 失败: HTTP {status} {body}")
    items = body.get("data")
    if not isinstance(items, list):
        raise AssertionError(f"[{label}] {target_path} 返回格式异常: {body}")
    model_ids = [str(item.get("id")) for item in items if isinstance(item, dict) and item.get("id")]
    if expected_model not in model_ids:
        raise AssertionError(f"[{label}] 未找到预期模型 '{expected_model}'，实际列表: {model_ids}")
    print(f"  ✅ [{label}] 鉴权 GET {target_path} -> HTTP 200, models={model_ids}", flush=True)
    return model_ids


def assert_streaming_chat(endpoint_v1: str, token: str, model_id: str) -> None:
    target = f"{endpoint_v1.rstrip('/')}/chat/completions"
    payload = {
        "model": model_id,
        "messages": [
            {
                "role": "user",
                "content": "请用中文简述12345政务热线工单研判系统的三个核心作用，每条不超过20字。",
            }
        ],
        "stream": True,
        "max_tokens": 200,
        "temperature": 0.1,
    }
    req = urllib.request.Request(
        target,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
            "User-Agent": "CivicRadar-ColabCtl/1.0",
        },
        method="POST",
    )

    t_start = time.perf_counter()
    t_first_token: Optional[float] = None
    chunk_count = 0
    content_chunks = 0
    completion_tokens: Optional[int] = None
    reply_parts: List[str] = []

    try:
        with urllib.request.urlopen(req, timeout=120.0) as resp:
            if resp.status != 200:
                raise AssertionError(f"[LLM Stream] 期望 HTTP 200，实际 {resp.status}")
            for raw_line in resp:
                line = raw_line.decode("utf-8", errors="replace").strip()
                if not line or not line.startswith("data:"):
                    continue
                data_str = line[5:].strip()
                if data_str == "[DONE]":
                    break
                try:
                    event = json.loads(data_str)
                except json.JSONDecodeError:
                    continue

                chunk_count += 1
                usage = event.get("usage")
                if isinstance(usage, dict) and isinstance(usage.get("completion_tokens"), int):
                    completion_tokens = usage["completion_tokens"]

                choices = event.get("choices") or []
                if choices and isinstance(choices[0], dict):
                    delta = choices[0].get("delta") or {}
                    piece = delta.get("content")
                    if isinstance(piece, str) and piece:
                        if t_first_token is None:
                            t_first_token = time.perf_counter()
                        content_chunks += 1
                        reply_parts.append(piece)
    except urllib.error.HTTPError as err:
        err_body = err.read().decode("utf-8", errors="replace")
        raise AssertionError(f"[LLM Stream] HTTP {err.code}: {err_body[:400]}") from err

    t_end = time.perf_counter()
    reply_text = "".join(reply_parts).strip()

    if chunk_count <= 5:
        raise AssertionError(f"[LLM Stream] SSE 分片数量不足: chunk_count={chunk_count} (要求 > 5)")
    if not reply_text or not CHINESE_CHAR_RE.search(reply_text):
        raise AssertionError(f"[LLM Stream] 未收到非空中文回复: {reply_text!r}")

    ttft_ms = ((t_first_token or t_end) - t_start) * 1000.0
    total_s = max(1e-6, t_end - t_start)
    decode_s = max(1e-6, t_end - (t_first_token or t_start))
    tok_count = completion_tokens if completion_tokens and completion_tokens > 0 else content_chunks
    decode_tok_s = (
        max(1, tok_count - 1) / decode_s if decode_s > 0.05 and tok_count > 1 else tok_count / total_s
    )
    tok_label = "tok/s" if completion_tokens else "chunks/s"
    preview = reply_text.replace("\n", " ")[:70]
    print(
        f"  ✅ [LLM Stream] HTTP 200 | chunks={chunk_count} | TTFT={ttft_ms:.1f} ms | "
        f"total={total_s:.2f} s | decode={decode_tok_s:.2f} {tok_label} | reply={preview}...",
        flush=True,
    )


def assert_embedding(endpoint_v1: str, token: str, embed_model: str) -> None:
    target = f"{endpoint_v1.rstrip('/')}/embeddings"
    target_path = urllib.parse.urlparse(target).path or "/v1/embeddings"
    payload = {
        "model": embed_model,
        "input": "居民反映小区夜间施工噪音扰民问题",
    }
    status, body = http_json_request(target, method="POST", token=token, payload=payload, timeout=30.0)
    if status != 200:
        raise AssertionError(f"[Embedding] POST {target_path} 失败: HTTP {status} {body}")
    data = body.get("data")
    if not isinstance(data, list) or not data:
        raise AssertionError(f"[Embedding] 返回 data 缺失: {body}")
    vec = data[0].get("embedding")
    if not isinstance(vec, list) or len(vec) != 1024:
        dim = len(vec) if isinstance(vec, list) else type(vec).__name__
        raise AssertionError(f"[Embedding] 期望 1024 维向量，实际: {dim}")
    if not all(isinstance(v, (int, float)) and math.isfinite(float(v)) for v in vec):
        raise AssertionError("[Embedding] 向量包含非有限浮点值")
    norm = math.sqrt(sum(float(v) * float(v) for v in vec))
    if abs(norm - 1.0) > 1e-2:
        raise AssertionError(f"[Embedding] 向量未归一化: L2 norm={norm:.6f}")
    print(f"  ✅ [Embedding] POST {target_path} -> HTTP 200 | dim={len(vec)} | L2 norm={norm:.6f}", flush=True)


def run_e2e_test(session: str) -> int:
    print(f"\n🧪 正在执行 Colab 会话 '{session}' E2E 端到端校验...", flush=True)
    tmp_cfg_path = create_secret_temp_file(".json")
    cfg: Optional[Dict[str, Any]] = None

    try:
        # 1) 按约定先尝试通过 colab download 拉取至 0600 临时文件，并在 finally 中删除
        try:
            proc = subprocess.run(
                ["colab", "download", "-s", session, REMOTE_CFG_FILE, str(tmp_cfg_path)],
                text=True,
                capture_output=True,
                timeout=30,
            )
            if proc.returncode == 0 and tmp_cfg_path.is_file() and tmp_cfg_path.stat().st_size > 0:
                os.chmod(tmp_cfg_path, 0o600)
                cfg = json.loads(tmp_cfg_path.read_text(encoding="utf-8"))
        except (subprocess.TimeoutExpired, json.JSONDecodeError, OSError):
            cfg = None

        if cfg is None:
            cfg = download_remote_cfg(session)
        if cfg is None:
            cfg = load_local_cache(session)
        if not cfg:
            raise RuntimeError(
                f"无法读取会话 '{session}' 的端点与 Token 配置（远端 {REMOTE_CFG_FILE} 与本地缓存均不可用）。"
            )

        token = str(cfg.get("token") or "")
        if not token:
            raise RuntimeError("配置中缺少 Bearer Token。")

        llm_url = cfg.get("llm_url")
        embed_url = cfg.get("embed_url")
        tunnel_mode = str(cfg.get("tunnel_mode") or cfg.get("tunnel") or "")
        llm_backend = str(cfg.get("llm_backend") or "ninfer")
        expected_llm_model = str(cfg.get("llm_model") or ("bonsai-2-27b" if llm_backend == "ninfer" else ""))
        expected_embed_model = str(cfg.get("embed_model") or "BAAI/bge-m3")

        if not llm_url and not embed_url:
            raise RuntimeError("配置中 llm_url 与 embed_url 均为空。")

        prop_timeout = 45.0 if tunnel_mode == "named" else 20.0
        print(
            f"  • 目标会话: {session} | 隧道: {tunnel_mode or 'unknown'} | Token: {mask_token(token)}",
            flush=True,
        )

        # 1) 未鉴权 GET /models -> 401（named 最长 45s / Quick Tunnel 最长 20s 边缘传播重试）
        if llm_url:
            assert_unauth_401(llm_url, "LLM", propagation_timeout=prop_timeout)
        if embed_url:
            assert_unauth_401(embed_url, "Embedding", propagation_timeout=prop_timeout)

        # 2) 鉴权 GET /models -> 断言 bonsai-2-27b / BAAI/bge-m3
        active_llm_model = expected_llm_model
        if llm_url:
            models = assert_auth_models(llm_url, token, expected_llm_model, "LLM")
            active_llm_model = expected_llm_model if expected_llm_model in models else models[0]
        if embed_url:
            assert_auth_models(embed_url, token, expected_embed_model, "Embedding")

        # 3) 鉴权流式 POST /v1/chat/completions
        if llm_url:
            assert_streaming_chat(llm_url, token, active_llm_model)

        # 4) 鉴权 POST /embeddings
        if embed_url:
            assert_embedding(embed_url, token, expected_embed_model)

        # 5) 打印远端 nvidia-smi 显存占用
        print("\n📊 远端 GPU 显存占用 (`nvidia-smi`):", flush=True)
        smi_out = query_remote_nvidia_smi(session)
        for line in smi_out.splitlines():
            print(f"  {line}", flush=True)

        print("\n✅ Colab E2E 全部校验通过！", flush=True)
        return 0
    finally:
        tmp_cfg_path.unlink(missing_ok=True)


def cmd_up(args: argparse.Namespace) -> int:
    if args.skip_llm and args.skip_embed:
        print("❌ 不能同时指定 --skip-llm 与 --skip-embed。", file=sys.stderr)
        return 2
    if not LOCAL_SERVE_SCRIPT.is_file():
        print(f"❌ 未找到 {LOCAL_SERVE_SCRIPT}", file=sys.stderr)
        return 1

    env_cfg = load_civic_colab_env()
    if args.tunnel == "auto":
        effective_tunnel = "named" if env_cfg["tunnel_token"] else "cloudflared"
    else:
        effective_tunnel = args.tunnel
    public_host = normalize_public_host(args.public_host or env_cfg["hostname"])
    tunnel_token = env_cfg["tunnel_token"] if effective_tunnel == "named" else ""

    if effective_tunnel == "named" and not tunnel_token:
        print(
            "❌ `--tunnel named` 需要配置 `CIVIC_COLAB_TUNNEL_TOKEN`（环境变量、仓库 .env.local / .env 或 ~/.agents/.env），"
            "或改用 `--tunnel cloudflared`。",
            file=sys.stderr,
        )
        return 1

    require_colab_cli()
    already_exists = session_exists(args.session)
    if already_exists and not args.reuse:
        print(
            f"❌ 会话 '{args.session}' 已存在。请传入 `--reuse` 复用，或先执行 `stop --session {args.session}`。",
            file=sys.stderr,
        )
        return 1

    manage_lifecycle = already_exists and args.reuse
    try:
        if not already_exists:
            manage_lifecycle = True
            tunnel_desc = (
                f"named ({public_host})"
                if effective_tunnel == "named"
                else effective_tunnel
            )
            print(
                f"🚀 正在申请 Colab {args.gpu} 会话 '{args.session}' (tunnel={tunnel_desc}) ...",
                flush=True,
            )
            try:
                proc = run_colab_cmd(
                    ["new", "-s", args.session, "--gpu", args.gpu],
                    timeout=270,
                    retries=0,
                )
            except RuntimeError:
                # 若 colab new 超时但后端实际已分配，先检查避免重复创建
                if not session_exists(args.session):
                    raise
                proc = None
            if proc is not None:
                cleaned = strip_colab_chatter(proc.stdout or "")
                if cleaned:
                    print(cleaned, flush=True)
        else:
            print(f"♻️ 复用现有 Colab 会话 '{args.session}' ...", flush=True)

        reuse_ready = False
        if args.reuse and already_exists:
            try:
                reuse_ready, existing_pid = check_remote_service_alive(args.session)
                if reuse_ready:
                    print(f"  • 检测到远端服务已在运行 (pid={existing_pid})，直接读取当前配置。", flush=True)
            except Exception:
                reuse_ready = False

        cached = load_local_cache(args.session) if args.reuse else None
        if effective_tunnel == "named":
            token = env_cfg["api_key"] or str((cached or {}).get("token") or "") or secrets.token_urlsafe(24)
        else:
            token = str((cached or {}).get("token") or "") or env_cfg["api_key"] or secrets.token_urlsafe(24)

        if not reuse_ready:
            print(f"📤 上传 {LOCAL_SERVE_SCRIPT.name} -> {REMOTE_SERVE_PATH} ...", flush=True)
            run_colab_cmd(
                ["upload", "-s", args.session, str(LOCAL_SERVE_SCRIPT), REMOTE_SERVE_PATH],
                timeout=45,
                retries=2,
            )
            start_script = build_remote_start_script(
                args,
                effective_tunnel=effective_tunnel,
                public_host=public_host,
            )
            remote_pid = launch_remote_detached(
                args.session,
                token,
                start_script,
                tunnel_token=tunnel_token or None,
            )
            print(f"⏳ 已在后台启动服务 (pid={remote_pid})，开始轮询 {REMOTE_LOG_FILE} ...", flush=True)
            poll_remote_startup(
                args.session,
                remote_pid,
                token,
                args.startup_timeout,
                tunnel_token=tunnel_token or None,
            )

        cfg = download_remote_cfg(args.session)
        if not cfg or not cfg.get("ready"):
            raise RuntimeError("远端服务报告就绪，但未能读取有效的运行配置。")

        resolved_token = str(cfg.get("token") or token)
        resolved_tunnel = str(cfg.get("tunnel_mode") or cfg.get("tunnel") or effective_tunnel)
        state_payload = {
            "session": args.session,
            "llm_url": cfg.get("llm_url"),
            "embed_url": cfg.get("embed_url"),
            "token": resolved_token,
            "llm_model": cfg.get("llm_model"),
            "embed_model": cfg.get("embed_model"),
            "llm_backend": cfg.get("llm_backend") or args.llm_backend,
            "tunnel": resolved_tunnel,
            "tunnel_mode": resolved_tunnel,
            "public_host": cfg.get("public_host") or (public_host if resolved_tunnel == "named" else None),
            "updated_at": int(time.time()),
        }
        cache_file = save_local_cache(args.session, state_payload)
        print_session_summary(
            args.session,
            state_payload,
            show_token=bool(args.show_token),
            cache_file=cache_file,
        )

        if args.test_and_stop:
            return run_e2e_test(args.session)
        return 0
    finally:
        if args.test_and_stop and manage_lifecycle:
            try:
                stop_session(args.session)
            except Exception as stop_exc:
                print(f"⚠️ 自动清理会话 '{args.session}' 失败: {stop_exc}", file=sys.stderr, flush=True)
                raise


def cmd_status(args: argparse.Namespace) -> int:
    require_colab_cli()
    status_proc = run_colab_cmd(["status", "-s", args.session], timeout=30, retries=1)
    status_out = strip_colab_chatter((status_proc.stdout or "") + "\n" + (status_proc.stderr or ""))
    print("📋 Colab 会话状态:")
    print(redact_text(status_out))

    if not session_exists(args.session):
        print(f"⚠️ 会话 '{args.session}' 当前未处于活动状态。")
        return 1

    print("\n🖥️ 远端 GPU (`nvidia-smi`):")
    print(query_remote_nvidia_smi(args.session))

    alive = False
    pid: Optional[int] = None
    try:
        alive, pid = check_remote_service_alive(args.session)
    except Exception:
        alive = False

    cfg = download_remote_cfg(args.session) or load_local_cache(args.session)
    print("\n🌐 推理服务与隧道:")
    print(f"  • 服务就绪  : {'YES' if (alive and cfg and cfg.get('ready', True)) else 'NO'} (pid={pid})")
    if cfg:
        tunnel_mode = cfg.get("tunnel_mode") or cfg.get("tunnel")
        if tunnel_mode:
            host_note = f" ({cfg.get('public_host')})" if cfg.get("public_host") else ""
            print(f"  • 隧道模式  : {tunnel_mode}{host_note}")
        if cfg.get("llm_url"):
            print(f"  • LLM URL   : {cfg.get('llm_url')} (model={cfg.get('llm_model')})")
        if cfg.get("embed_url"):
            print(f"  • Embed URL : {cfg.get('embed_url')} (model={cfg.get('embed_model')})")
        print(f"  • Token     : {mask_token(str(cfg.get('token') or ''))}")
    else:
        print("  • 未找到远端或本地缓存端点配置。")
    return 0


def cmd_test(args: argparse.Namespace) -> int:
    require_colab_cli()
    if not session_exists(args.session):
        print(f"❌ 会话 '{args.session}' 不存在或未启动。", file=sys.stderr)
        return 1
    return run_e2e_test(args.session)


def cmd_stop(args: argparse.Namespace) -> int:
    require_colab_cli()
    stop_session(args.session)
    return 0


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="民声智理 · Google Colab GPU 会话编排与 E2E 校验 CLI"
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_up = sub.add_parser("up", help="启动 Colab GPU 会话、部署推理服务并建立隧道")
    p_up.add_argument("--gpu", type=str.upper, default=DEFAULT_GPU, choices=GPU_CHOICES, help="GPU 型号 (默认 L4)")
    p_up.add_argument("--session", default=DEFAULT_SESSION, help=f"Colab 会话名 (默认 {DEFAULT_SESSION})")
    p_up.add_argument(
        "--tunnel",
        default="auto",
        choices=TUNNEL_CHOICES,
        help="隧道模式 (默认 auto: 检测到 CIVIC_COLAB_TUNNEL_TOKEN 自动启用 named，否则回退 cloudflared)",
    )
    p_up.add_argument(
        "--public-host",
        default=None,
        help=f"Named Tunnel 公网域名 (默认读取 CIVIC_COLAB_HOSTNAME 或 {DEFAULT_PUBLIC_HOST})",
    )
    p_up.add_argument("--llm-backend", default="ninfer", choices=BACKEND_CHOICES, help="LLM 后端 (默认 ninfer)")
    p_up.add_argument("--llm-model", default=None, help="覆盖 System-2 模型路径或 HF repo:file")
    p_up.add_argument("--max-concurrency", type=int, default=None, help="ninfer 最大并发度")
    p_up.add_argument("--kv-capacity", type=int, default=None, help="ninfer 共享 KV 容量 (tokens)")
    p_up.add_argument("--skip-embed", action="store_true", help="跳过启动 BAAI/bge-m3 向量服务")
    p_up.add_argument("--skip-llm", action="store_true", help="跳过启动 System-2 LLM 服务")
    p_up.add_argument("--startup-timeout", type=int, default=900, help="服务启动超时秒数 (默认 900)")
    p_up.add_argument("--reuse", action="store_true", help="复用已存在的同名会话")
    p_up.add_argument("--show-token", action="store_true", help="启动完成时在终端明文显示一次 Token")
    p_up.add_argument("--test-and-stop", action="store_true", help="启动完成后立即执行 E2E 校验并在 finally 中强制停止会话")

    p_status = sub.add_parser("status", help="查看会话状态、远端 nvidia-smi 与隧道就绪情况")
    p_status.add_argument("--session", default=DEFAULT_SESSION, help=f"Colab 会话名 (默认 {DEFAULT_SESSION})")

    p_test = sub.add_parser("test", help="对运行中的 Colab 会话执行完整 E2E 接口与显存验证")
    p_test.add_argument("--session", default=DEFAULT_SESSION, help=f"Colab 会话名 (默认 {DEFAULT_SESSION})")

    p_stop = sub.add_parser("stop", help="优雅停止远端服务并销毁 Colab 会话")
    p_stop.add_argument("--session", default=DEFAULT_SESSION, help=f"Colab 会话名 (默认 {DEFAULT_SESSION})")

    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    raw_argv = list(sys.argv[1:] if argv is None else argv)
    # 兼容 `pnpm colab:verify -- --session ...` 透传的独立 `--` 分隔符
    cleaned_argv = [arg for arg in raw_argv if arg != "--"]

    parser = build_arg_parser()
    args = parser.parse_args(cleaned_argv)

    try:
        if args.command == "up":
            return cmd_up(args)
        if args.command == "status":
            return cmd_status(args)
        if args.command == "test":
            return cmd_test(args)
        if args.command == "stop":
            return cmd_stop(args)
        parser.print_help()
        return 2
    except KeyboardInterrupt:
        print("\n⚠️ 操作被用户中断 (KeyboardInterrupt)。", file=sys.stderr, flush=True)
        return 130
    except AssertionError as exc:
        print(f"\n❌ 校验失败: {exc}", file=sys.stderr, flush=True)
        return 1
    except Exception as exc:
        print(f"\n❌ 执行错误: {exc}", file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    sys.exit(main())
