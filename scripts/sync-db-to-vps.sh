#!/usr/bin/env bash
# CivicPulse 12345 · 兼容别名脚本 -> 指向统一双向同步脚本 (以推送模式运行)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "${SCRIPT_DIR}/sync-db.sh" --push "$@"
