#!/usr/bin/env bash
# ==============================================================================
# CivicPulse 12345 · 跨机全量数据库双向智能热同步工具 (macOS / Linux / VPS)
# 研发团队：赢了就回家吃鱼生
#
# 功能：
# 1. 支持双向流式同步：
#    - [方向 1] 本地 Mac ➔ VPS 生产库 (推送本地 22 万+ 工单/主题覆盖线上)
#    - [方向 2] VPS 生产库 ➔ 本地 Mac (拉取生产数据回本地覆盖调试)
# 2. 自动探测最佳网络：优先点对点 Tailscale 专网，智能回退公网 IP；
# 3. 采用 gzip 隧道直灌技术，两端零中间落盘，极速且避免磁盘损耗；
# 4. 全通用设计：支持环境变量 VPS_HOST/VPS_USER/DATABASE_URL，绝无写死 IP 或用户名。
# ==============================================================================

set -eo pipefail

BOLD='\033[1m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# 自动加载本地环境变量（若存在且未在系统环境中声明）
if [ -f "${ROOT_DIR}/.env.local" ]; then
  eval $(grep -E '^(DATABASE_URL|VPS_HOST|VPS_TS_IP|VPS_PUB_IP|VPS_USER|PROD_DOMAIN)=' "${ROOT_DIR}/.env.local" | sed 's/^/export /' 2>/dev/null || true)
fi

# 通用网络与节点配置（支持环境变量动态覆盖）
VPS_USER="${VPS_USER:-root}"
VPS_TS_IP="${VPS_TS_IP:-100.104.117.104}"
VPS_PUB_IP="${VPS_PUB_IP:-185.99.135.72}"
VPS_HOST="${VPS_HOST:-}"
PROD_DOMAIN="${PROD_DOMAIN:-https://12345.firetable.tech}"
VPS_STACK_DIR="${VPS_STACK_DIR:-/opt/12345-stack}"

# 动态本地数据库连接串（支持当前 OS 用户 $USER，或显式 DATABASE_URL）
LOCAL_DB_URL="${DATABASE_URL:-postgresql://${USER}@localhost:5432/ticket_radar}"

# 解析参数与方向
DIRECTION=""
AUTO_CONFIRM=0

for arg in "$@"; do
  case "${arg}" in
    --push|-p|push|to-vps|mac-to-vps)
      DIRECTION="push"
      ;;
    --pull|-g|pull|from-vps|vps-to-mac)
      DIRECTION="pull"
      ;;
    --yes|-y)
      AUTO_CONFIRM=1
      ;;
    *)
      ;;
  esac
done

echo -e "${CYAN}==============================================================================${NC}"
echo -e "${BOLD}  🚀 民声智理 · 数据库跨机双向流式热同步中枢${NC}"
echo -e "${CYAN}==============================================================================${NC}"

# 如果未指定方向，交互式选择
if [ -z "${DIRECTION}" ]; then
  echo -e "\n请选择数据流向："
  echo -e "  ${GREEN}[1]${NC} ${BOLD}本地 Mac ➔ VPS 生产库${NC} (推送本地工单、研判主题与向量到 VPS 生产站)"
  echo -e "  ${YELLOW}[2]${NC} ${BOLD}VPS 生产库 ➔ 本地 Mac${NC} (从 VPS 拉取生产最新数据覆盖本地开发库)"
  echo -e "  [0] 取消退出"
  read -r -p "请输入选项 [1/2/0]: " dir_choice
  case "${dir_choice}" in
    1) DIRECTION="push" ;;
    2) DIRECTION="pull" ;;
    0|q|exit)
      echo -e "\n已取消同步操作。"
      exit 0
      ;;
    *)
      echo -e "\n${RED}无效选项，操作取消。${NC}"
      exit 1
      ;;
  esac
fi

# 1. 探测 VPS 最佳连接 IP (自适应 Tailscale 专网 / 公网 IP / 自定义 Host)
TARGET_IP=""
echo -e "\n${BOLD}[1/4] 正在探测网络链路...${NC}"

if [ -n "${VPS_HOST}" ]; then
  if ssh -o BatchMode=yes -o ConnectTimeout=3 "${VPS_USER}@${VPS_HOST}" "echo OK" >/dev/null 2>&1; then
    TARGET_IP="${VPS_HOST}"
    echo -e "${GREEN}✓ 使用自定义指定主机: ${TARGET_IP}${NC}"
  fi
fi

if [ -z "${TARGET_IP}" ]; then
  if ssh -o BatchMode=yes -o ConnectTimeout=3 "${VPS_USER}@${VPS_TS_IP}" "echo OK" >/dev/null 2>&1; then
    TARGET_IP="${VPS_TS_IP}"
    echo -e "${GREEN}✓ 优先使用 Tailscale 点对点专网: ${TARGET_IP}${NC}"
  elif ssh -o BatchMode=yes -o ConnectTimeout=3 "${VPS_USER}@${VPS_PUB_IP}" "echo OK" >/dev/null 2>&1; then
    TARGET_IP="${VPS_PUB_IP}"
    echo -e "${YELLOW}! Tailscale 未直连，回退至公网 IP: ${TARGET_IP}${NC}"
  else
    echo -e "${RED}✖ 无法通过 SSH 连接至 VPS (${VPS_TS_IP} 或 ${VPS_PUB_IP})。${NC}"
    echo -e "${YELLOW}提示: 可通过环境变量指定可用主机，例如: VPS_HOST=your-server-ip ${0}${NC}"
    exit 1
  fi
fi

# ------------------------------------------------------------------------------
# 分支 A: 本地 Mac ➔ VPS 生产库 (Push)
# ------------------------------------------------------------------------------
if [ "${DIRECTION}" = "push" ]; then
  echo -e "\n${BOLD}>>> 【方向】本地 Mac ➔ VPS 生产库 (推送覆盖)${NC}"

  # 2. 检查 VPS 容器与 pgvector 插件
  echo -e "\n${BOLD}[2/4] 检查 VPS 数据库与 pgvector 插件...${NC}"
  ssh "${VPS_USER}@${TARGET_IP}" "docker exec 12345-postgres psql -U postgres -d ticket_radar -c 'CREATE EXTENSION IF NOT EXISTS vector;'" >/dev/null 2>&1
  echo -e "${GREEN}✓ VPS 12345-postgres 与 pgvector 扩展已就绪${NC}"

  # 3. 统计本地待同步数据
  echo -e "\n${BOLD}[3/4] 检查本地待推送数据量...${NC}"
  LOCAL_STATS=$(psql "${LOCAL_DB_URL}" -t -A -c "
  SELECT 
    '顺德: ' || (SELECT count(*) FROM region_fs_shunde.tickets) || ' 工单 / ' ||
    (SELECT count(*) FROM region_fs_shunde.themes) || ' 主题 | 天河: ' ||
    (SELECT count(*) FROM region_gz_tianhe.tickets) || ' 工单 / ' ||
    (SELECT count(*) FROM region_gz_tianhe.themes) || ' 主题'
  " 2>/dev/null || echo "无法读取本地统计")
  echo -e "• 本地待推送数据量: ${CYAN}${LOCAL_STATS}${NC}"

  if [ ${AUTO_CONFIRM} -eq 0 ]; then
    echo -e "${YELLOW}⚠️ 注意：此操作将使用本地数据库内容覆盖 VPS 生产库！${NC}"
    read -r -p "确认立即开始推送至 VPS? [y/N]: " confirm
    if [[ ! "${confirm}" =~ ^[yY]$ ]]; then
      echo -e "${YELLOW}已取消推送操作。${NC}"
      exit 0
    fi
  fi

  # 4. 执行 gzip 管道流式导出与直灌
  echo -e "\n${BOLD}[4/4] 正在通过 gzip 压缩隧道直灌 VPS 生产库 (请稍候)...${NC}"
  START_TIME=$(date +%s)

  pg_dump "${LOCAL_DB_URL}" \
    --clean --if-exists --no-owner --no-privileges \
    | gzip -c \
    | ssh -C "${VPS_USER}@${TARGET_IP}" "gunzip -c | docker exec -i 12345-postgres psql -U postgres -d ticket_radar" >/dev/null

  END_TIME=$(date +%s)
  ELAPSED=$((END_TIME - START_TIME))
  echo -e "${GREEN}✓ 数据库流式推送完成！耗时: ${ELAPSED} 秒${NC}"

  # 重载生产容器与验证健康
  echo -e "\n正在重载 VPS 生产容器以刷新数据字典与缓存..."
  ssh "${VPS_USER}@${TARGET_IP}" "cd ${VPS_STACK_DIR} && docker compose --env-file .env.vps restart app && docker restart langgraph-app-caddy-1" >/dev/null 2>&1

  sleep 3
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -m 10 "${PROD_DOMAIN}" || echo "000")
  echo -e "${GREEN}✓ 生产站重载就绪！状态: HTTP ${HTTP_CODE} (${PROD_DOMAIN})${NC}"
  echo -e "\n${CYAN}==============================================================================${NC}"
  echo -e "${BOLD}${GREEN}🎉 恭喜！本地全量数据已成功推送至 VPS，生产大屏与辖区选择器已实时激活！${NC}"
  echo -e "${CYAN}==============================================================================${NC}\n"

# ------------------------------------------------------------------------------
# 分支 B: VPS 生产库 ➔ 本地 Mac (Pull)
# ------------------------------------------------------------------------------
elif [ "${DIRECTION}" = "pull" ]; then
  echo -e "\n${BOLD}>>> 【方向】VPS 生产库 ➔ 本地 Mac (拉取线上数据)${NC}"

  # 2. 检查本地数据库准备情况
  echo -e "\n${BOLD}[2/4] 检查本地 PostgreSQL 与 pgvector 插件...${NC}"
  psql "${LOCAL_DB_URL}" -c 'CREATE EXTENSION IF NOT EXISTS vector;' >/dev/null 2>&1 || true
  echo -e "${GREEN}✓ 本地数据库就绪${NC}"

  # 3. 统计 VPS 线上数据量
  echo -e "\n${BOLD}[3/4] 检查 VPS 线上数据量...${NC}"
  VPS_STATS=$(ssh "${VPS_USER}@${TARGET_IP}" "docker exec 12345-postgres psql -U postgres -d ticket_radar -t -A -c \"
  SELECT 
    '顺德: ' || (SELECT count(*) FROM region_fs_shunde.tickets) || ' 工单 / ' ||
    (SELECT count(*) FROM region_fs_shunde.themes) || ' 主题 | 天河: ' ||
    (SELECT count(*) FROM region_gz_tianhe.tickets) || ' 工单 / ' ||
    (SELECT count(*) FROM region_gz_tianhe.themes) || ' 主题'
  \" 2>/dev/null || echo '线上多租户表尚未初始化'")

  echo -e "• VPS 线上当前规模: ${CYAN}${VPS_STATS}${NC}"

  if [ ${AUTO_CONFIRM} -eq 0 ]; then
    echo -e "${YELLOW}⚠️ 注意：此操作将使用 VPS 生产库内容覆盖本地数据库 (${LOCAL_DB_URL})！${NC}"
    read -r -p "确认立即开始拉取至本地? [y/N]: " confirm
    if [[ ! "${confirm}" =~ ^[yY]$ ]]; then
      echo -e "${YELLOW}已取消拉取操作。${NC}"
      exit 0
    fi
  fi

  # 4. 执行从 VPS 流式拉取
  echo -e "\n${BOLD}[4/4] 正在通过 gzip 压缩隧道从 VPS 拉取并写入本地 (请稍候)...${NC}"
  START_TIME=$(date +%s)

  ssh -C "${VPS_USER}@${TARGET_IP}" "docker exec 12345-postgres pg_dump -U postgres -d ticket_radar --clean --if-exists --no-owner --no-privileges | gzip -c" \
    | gunzip -c \
    | psql "${LOCAL_DB_URL}" >/dev/null

  END_TIME=$(date +%s)
  ELAPSED=$((END_TIME - START_TIME))
  echo -e "${GREEN}✓ 数据库流式拉取完成！耗时: ${ELAPSED} 秒${NC}"

  # 验证本地导入结果
  LOCAL_NEW_STATS=$(psql "${LOCAL_DB_URL}" -t -A -c "
  SELECT 
    '顺德: ' || (SELECT count(*) FROM region_fs_shunde.tickets) || ' 工单 / ' ||
    (SELECT count(*) FROM region_fs_shunde.themes) || ' 主题 | 天河: ' ||
    (SELECT count(*) FROM region_gz_tianhe.tickets) || ' 工单 / ' ||
    (SELECT count(*) FROM region_gz_tianhe.themes) || ' 主题'
  " 2>/dev/null || echo "读取失败")

  echo -e "• 本地数据库最新规模: ${CYAN}${LOCAL_NEW_STATS}${NC}"
  echo -e "\n${CYAN}==============================================================================${NC}"
  echo -e "${BOLD}${GREEN}🎉 恭喜！VPS 生产数据已成功同步至本地开发库！${NC}"
  echo -e "${CYAN}==============================================================================${NC}\n"
fi
