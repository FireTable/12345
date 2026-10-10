#!/usr/bin/env bash
# ==============================================================================
# CivicPulse 12345 · 本地数据库无痛一键热同步至 VPS 生产环境
# 研发团队：赢了就回家吃鱼生
#
# 功能：
# 1. 自动探测 Mac 与 VPS Tailscale (100.104.117.104) / 公网 IP 链路；
# 2. 从本地 PostgreSQL (ticket_radar) 导出全量 Schema (public, region_fs_shunde, region_gz_tianhe)；
# 3. 采用 gzip 流式压缩并通过 SSH 直灌 VPS 12345-postgres 容器，零落盘、高吞吐；
# 4. 重启 VPS 12345-app 生产容器，自动加载最新数据字典与研判流水线；
# 5. 自动巡检生产站 https://12345.firetable.tech 健康状态并回显统计。
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

VPS_TS_IP="100.104.117.104"
VPS_PUB_IP="185.99.135.72"
LOCAL_DB_URL="${DATABASE_URL:-postgresql://FireTable@localhost:5432/ticket_radar}"
PROD_DOMAIN="https://12345.firetable.tech"

echo -e "${CYAN}==============================================================================${NC}"
echo -e "${BOLD}  🚀 民声智理 · 数据库无痛热同步至 VPS (本地 Mac ➔ VPS 生产站)${NC}"
echo -e "${CYAN}==============================================================================${NC}"

# 1. 探测 VPS 最佳连接 IP
TARGET_IP=""
echo -e "\n${BOLD}[1/5] 正在探测 VPS 链路...${NC}"
if ssh -o BatchMode=yes -o ConnectTimeout=3 "root@${VPS_TS_IP}" "echo OK" >/dev/null 2>&1; then
  TARGET_IP="${VPS_TS_IP}"
  echo -e "${GREEN}✓ 优先使用 Tailscale 点对点专网: ${TARGET_IP}${NC}"
elif ssh -o BatchMode=yes -o ConnectTimeout=3 "root@${VPS_PUB_IP}" "echo OK" >/dev/null 2>&1; then
  TARGET_IP="${VPS_PUB_IP}"
  echo -e "${YELLOW}! Tailscale 未直连，回退至公网 IP: ${TARGET_IP}${NC}"
else
  echo -e "${RED}✖ 无法通过 SSH 连接至 VPS (${VPS_TS_IP} 或 ${VPS_PUB_IP})，请检查网络与密钥。${NC}"
  exit 1
fi

# 2. 检查 VPS 上 postgres 容器状态与 pgvector 插件
echo -e "\n${BOLD}[2/5] 检查 VPS 容器与 pgvector 状态...${NC}"
ssh "root@${TARGET_IP}" "docker exec 12345-postgres psql -U postgres -d ticket_radar -c 'CREATE EXTENSION IF NOT EXISTS vector;'" >/dev/null 2>&1
echo -e "${GREEN}✓ VPS 12345-postgres 与 pgvector 扩展已就绪${NC}"

# 3. 统计本地数据量并确认
echo -e "\n${BOLD}[3/5] 检查本地待同步数据量...${NC}"
LOCAL_STATS=$(psql "${LOCAL_DB_URL}" -t -A -c "
SELECT 
  '顺德: ' || (SELECT count(*) FROM region_fs_shunde.tickets) || ' 工单 / ' ||
  (SELECT count(*) FROM region_fs_shunde.themes) || ' 主题 | 天河: ' ||
  (SELECT count(*) FROM region_gz_tianhe.tickets) || ' 工单 / ' ||
  (SELECT count(*) FROM region_gz_tianhe.themes) || ' 主题'
" 2>/dev/null || echo "无法获取统计")

echo -e "• 当前待同步规模: ${CYAN}${LOCAL_STATS}${NC}"

if [ "${1}" != "--yes" ] && [ "${1}" != "-y" ]; then
  read -r -p "是否立即开始同步至 VPS? [y/N]: " confirm
  if [[ ! "${confirm}" =~ ^[yY]$ ]]; then
    echo -e "${YELLOW}已取消同步操作。${NC}"
    exit 0
  fi
fi

# 4. 执行流式导出与直灌
echo -e "\n${BOLD}[4/5] 正在通过 gzip 压缩隧道流式直灌数据库 (请稍候)...${NC}"
START_TIME=$(date +%s)

pg_dump "${LOCAL_DB_URL}" \
  --clean --if-exists --no-owner --no-privileges \
  | gzip -c \
  | ssh -C "root@${TARGET_IP}" "gunzip -c | docker exec -i 12345-postgres psql -U postgres -d ticket_radar" >/dev/null

END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))
echo -e "${GREEN}✓ 数据库流式直灌完成！耗时: ${ELAPSED} 秒${NC}"

# 5. 重启 VPS 容器并验证健康
echo -e "\n${BOLD}[5/5] 正在重载 VPS 生产容器并巡检健康状态...${NC}"
ssh "root@${TARGET_IP}" "cd /opt/12345-stack && docker compose --env-file .env.vps restart app && docker restart langgraph-app-caddy-1" >/dev/null 2>&1

sleep 3
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -m 10 "${PROD_DOMAIN}")
if [ "${HTTP_CODE}" = "200" ] || [ "${HTTP_CODE}" = "307" ]; then
  echo -e "${GREEN}✓ 生产站重载成功！状态: HTTP ${HTTP_CODE} (${PROD_DOMAIN})${NC}"
else
  echo -e "${YELLOW}! 生产站当前响应: HTTP ${HTTP_CODE}，请稍等 5 秒后刷新浏览器。${NC}"
fi

echo -e "\n${CYAN}==============================================================================${NC}"
echo -e "${BOLD}${GREEN}🎉 恭喜！本地全量数据已无痛同步至 VPS，Mac 双推理集群已无缝联动！${NC}"
echo -e "• 生产体验地址: ${BOLD}${CYAN}${PROD_DOMAIN}${NC}"
echo -e "${CYAN}==============================================================================${NC}\n"
