#!/usr/bin/env bash
# ==============================================================================
# CivicRadar 12345 · 跨机混合推理与全栈智能治理运维管理终端 (macOS / Linux)
# 研发团队：赢了就回家吃鱼生
# ==============================================================================

set -o pipefail

# 颜色与样式
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# 路径与环境
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}" || exit 1

S2_SCRIPT="${ROOT_DIR}/packages/civic-system-two/scripts/serve.ts"
EMBED_SCRIPT="${ROOT_DIR}/packages/civic-embed/scripts/serve.ts"

# 自动加载本地环境变量（若存在且未在系统环境中声明）
if [ -f "${ROOT_DIR}/.env.local" ]; then
  eval $(grep -E '^(DATABASE_URL|VPS_HOST|VPS_TS_IP|VPS_PUB_IP|VPS_USER|PROD_DOMAIN|MAC_NODE_IP)=' "${ROOT_DIR}/.env.local" | sed 's/^/export /' 2>/dev/null || true)
fi

# 通用网络与节点配置（支持环境变量动态覆盖，杜绝硬编码）
VPS_USER="${VPS_USER:-root}"
VPS_TS_IP="${VPS_TS_IP:-100.104.117.104}"
VPS_PUB_IP="${VPS_PUB_IP:-185.99.135.72}"
VPS_HOST="${VPS_HOST:-}"
WIN_TS_IP="${WIN_TS_IP:-100.90.35.38}"
PROD_DOMAIN="${PROD_DOMAIN:-https://12345.firetable.tech}"
VPS_STACK_DIR="${VPS_STACK_DIR:-/opt/12345-stack}"

# 动态本地数据库连接串（支持当前 OS 用户 $USER，或显式 DATABASE_URL）
LOCAL_DB_URL="${DATABASE_URL:-postgresql://${USER}@localhost:5432/ticket_radar}"

# ------------------------------------------------------------------------------
# 辅助函数：网络与状态探测
# ------------------------------------------------------------------------------
get_mac_node_ip() {
  if [ -n "${MAC_NODE_IP}" ]; then
    echo "${MAC_NODE_IP}"
    return 0
  fi
  local ip=""
  if command -v tailscale >/dev/null 2>&1; then
    ip=$(tailscale ip -4 2>/dev/null | head -n 1)
  fi
  if [ -z "${ip}" ] && command -v ipconfig >/dev/null 2>&1; then
    ip=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)
  fi
  if [ -z "${ip}" ] && command -v hostname >/dev/null 2>&1; then
    ip=$(hostname -I 2>/dev/null | awk '{print $1}' || true)
  fi
  echo "${ip:-未连接}"
}

get_vps_ssh_target() {
  if [ -n "${VPS_HOST}" ]; then
    echo "${VPS_HOST}"
    return 0
  fi
  if ssh -o BatchMode=yes -o ConnectTimeout=2 "${VPS_USER}@${VPS_TS_IP}" "echo OK" >/dev/null 2>&1; then
    echo "${VPS_TS_IP}"
    return 0
  fi
  if ssh -o BatchMode=yes -o ConnectTimeout=2 "${VPS_USER}@${VPS_PUB_IP}" "echo OK" >/dev/null 2>&1; then
    echo "${VPS_PUB_IP}"
    return 0
  fi
  echo "${VPS_TS_IP}"
}

check_port() {
  local port=$1
  if lsof -i:"${port}" -sTCP:LISTEN >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

check_pm2_app() {
  local app_name=$1
  if command -v pm2 >/dev/null 2>&1; then
    local status
    status=$(pm2 jlist 2>/dev/null | node -e "
      try {
        const list = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
        const app = list.find(x => x.name === '${app_name}');
        console.log(app ? app.pm2_env.status : 'not_found');
      } catch (e) { console.log('error'); }
    ")
    echo "${status}"
  else
    echo "pm2_missing"
  fi
}

# ------------------------------------------------------------------------------
# 仪表盘绘制
# ------------------------------------------------------------------------------
show_header() {
  clear
  local mac_ip
  mac_ip=$(get_mac_node_ip)
  [ -z "${mac_ip}" ] && mac_ip="未连接"

  local vps_target
  vps_target=$(get_vps_ssh_target)

  local s2_status
  s2_status=$(check_pm2_app "civic-s2")
  local embed_status
  embed_status=$(check_pm2_app "civic-embed")

  local s2_port_tag
  if check_port 8132; then
    s2_port_tag="${GREEN}● 8132 端口监听中${NC}"
  else
    s2_port_tag="${RED}○ 8132 未监听${NC}"
  fi

  local embed_port_tag
  if check_port 8133; then
    embed_port_tag="${GREEN}● 8133 端口监听中${NC}"
  else
    embed_port_tag="${RED}○ 8133 未监听${NC}"
  fi

  local s2_state_display
  if [ "${s2_status}" = "online" ]; then
    s2_state_display="${GREEN}● PM2 在线 [online]${NC}"
  elif [ "${s2_status}" = "errored" ]; then
    s2_state_display="${RED}✖ PM2 异常 [errored]${NC}"
  else
    s2_state_display="${YELLOW}○ PM2 未常驻 (${s2_status})${NC}"
  fi

  local embed_state_display
  if [ "${embed_status}" = "online" ]; then
    embed_state_display="${GREEN}● PM2 在线 [online]${NC}"
  elif [ "${embed_status}" = "errored" ]; then
    embed_state_display="${RED}✖ PM2 异常 [errored]${NC}"
  else
    embed_state_display="${YELLOW}○ PM2 未常驻 (${embed_status})${NC}"
  fi

  echo -e "${CYAN}================================================================================${NC}"
  echo -e "${BOLD}  🏛️  CivicRadar 12345 · 跨机混合推理与全栈智能治理控制台 (macOS)${NC}"
  echo -e "${CYAN}================================================================================${NC}"
  echo -e "  🖥️  ${BOLD}Mac 本地节点${NC}  : 节点 IP [${BOLD}${mac_ip}${NC}]"
  echo -e "  ☁️  ${BOLD}VPS 云端节点${NC}  : [${BOLD}${vps_target}${NC}] (生产站: ${CYAN}${PROD_DOMAIN}${NC})"
  echo -e "  ------------------------------------------------------------------------------"
  echo -e "  🧠  ${BOLD}System-2 (27B)${NC}: ${s2_state_display} | ${s2_port_tag}"
  echo -e "  🔍  ${BOLD}Civic-Embed${NC}   : ${embed_state_display} | ${embed_port_tag}"
  echo -e "${CYAN}================================================================================${NC}"
}

# ------------------------------------------------------------------------------
# 功能实现
# ------------------------------------------------------------------------------

# 1. 开启常驻 PM2 服务
action_start_pm2() {
  echo -e "\n${BOLD}>>> [1/4] 检查并清理冲突端口 (8132 / 8133)...${NC}"
  local pids_8132
  pids_8132=$(lsof -ti:8132 2>/dev/null || true)
  local pids_8133
  pids_8133=$(lsof -ti:8133 2>/dev/null || true)

  # 如果不是 pm2 纳管的单独进程，先温和杀掉避免端口 bind error
  if [ -n "${pids_8132}" ] && [ "$(check_pm2_app "civic-s2")" != "online" ]; then
    echo -e "${YELLOW}检测到 8132 端口被非 PM2 孤儿进程占用 (PID: ${pids_8132})，正在释放...${NC}"
    kill -9 ${pids_8132} 2>/dev/null || true
  fi
  if [ -n "${pids_8133}" ] && [ "$(check_pm2_app "civic-embed")" != "online" ]; then
    echo -e "${YELLOW}检测到 8133 端口被非 PM2 孤儿进程占用 (PID: ${pids_8133})，正在释放...${NC}"
    kill -9 ${pids_8133} 2>/dev/null || true
  fi

  echo -e "${BOLD}>>> [2/4] 启动 System-2 27B 慢思考大模型 (Port: 8132)...${NC}"
  if [ "$(check_pm2_app "civic-s2")" = "online" ]; then
    echo -e "${GREEN}✓ civic-s2 已在运行中，执行重载环境...${NC}"
    pm2 restart civic-s2 --update-env
  else
    pm2 delete civic-s2 2>/dev/null || true
    PORT=8132 HOST=0.0.0.0 pm2 start npx --name civic-s2 -- tsx "${S2_SCRIPT}"
  fi

  echo -e "${BOLD}>>> [3/4] 启动 Civic-Embed bge-m3 密集向量模型 (Port: 8133)...${NC}"
  if [ "$(check_pm2_app "civic-embed")" = "online" ]; then
    echo -e "${GREEN}✓ civic-embed 已在运行中，执行重载环境...${NC}"
    pm2 restart civic-embed --update-env
  else
    pm2 delete civic-embed 2>/dev/null || true
    EMBED_PORT=8133 EMBED_HOST=0.0.0.0 pm2 start npx --name civic-embed -- tsx "${EMBED_SCRIPT}"
  fi

  echo -e "${BOLD}>>> [4/4] 持久化 PM2 配置并执行就绪探测...${NC}"
  pm2 save

  echo -e "\n⏳ 等待模型加载并进行端口可用性自检 (最多等待 20 秒)..."
  local attempts=0
  local s2_ok=0
  local embed_ok=0
  while [ ${attempts} -lt 20 ]; do
    if [ ${s2_ok} -eq 0 ] && curl -s -m 1 http://127.0.0.1:8132/v1/models | grep -q "bonsai-2-27b"; then
      s2_ok=1
      echo -e "${GREEN}✓ System-2 (27B) 已就绪！(http://0.0.0.0:8132/v1)${NC}"
    fi
    if [ ${embed_ok} -eq 0 ] && curl -s -m 1 http://127.0.0.1:8133/v1/models | grep -q "bge-m3"; then
      embed_ok=1
      echo -e "${GREEN}✓ Civic-Embed (bge-m3) 已就绪！(http://0.0.0.0:8133/v1)${NC}"
    fi
    if [ ${s2_ok} -eq 1 ] && [ ${embed_ok} -eq 1 ]; then
      break
    fi
    sleep 1
    attempts=$((attempts + 1))
  done

  if [ ${s2_ok} -eq 1 ] && [ ${embed_ok} -eq 1 ]; then
    echo -e "\n${GREEN}🎉 双模型常驻集群已全部正常在线！可通过 Tailscale 跨机调用。${NC}"
  else
    echo -e "\n${YELLOW}⚠️ 探测超时，请使用选项 [4] 查看日志排查加载进度。${NC}"
  fi
}

# 2. 关闭常驻 PM2 服务
action_stop_pm2() {
  echo -e "\n${BOLD}>>> 正在注销并停止 PM2 推理服务...${NC}"
  pm2 stop civic-s2 civic-embed 2>/dev/null || true
  pm2 delete civic-s2 civic-embed 2>/dev/null || true
  pm2 save

  echo -e "${BOLD}>>> 彻底清理残留端口与释放 Metal 显存...${NC}"
  local pids_8132
  pids_8132=$(lsof -ti:8132 2>/dev/null || true)
  [ -n "${pids_8132}" ] && kill -9 ${pids_8132} 2>/dev/null || true

  local pids_8133
  pids_8133=$(lsof -ti:8133 2>/dev/null || true)
  [ -n "${pids_8133}" ] && kill -9 ${pids_8133} 2>/dev/null || true

  echo -e "${GREEN}✓ 双推理服务已彻底停止，显存已全部释放！${NC}"
}

# 3. 重启 PM2 双推理服务
action_restart_pm2() {
  echo -e "\n${BOLD}>>> 正在重启 PM2 双推理服务...${NC}"
  pm2 restart civic-s2 civic-embed
  pm2 save
  echo -e "${GREEN}✓ 重启指令已下发。${NC}"
}

# 4. 查看实时日志
action_view_logs() {
  echo -e "\n${CYAN}>>> 按 Ctrl+C 可退出实时日志流：${NC}\n"
  pm2 logs civic-s2 civic-embed --lines 30
}

# 5. 查看显存与进程详情
action_view_metrics() {
  echo -e "\n${BOLD}=== PM2 服务清单 ===${NC}"
  pm2 list
  echo -e "\n${BOLD}=== Apple Silicon / Metal 进程详情 ===${NC}"
  ps -eo pid,%cpu,%mem,command | grep -E "llama-server|civic-" | grep -v grep || echo "未找到活跃模型引擎"
  echo -e "\n${BOLD}=== 端口监听状态 ===${NC}"
  lsof -i:8132 -i:8133 2>/dev/null || echo "端口 8132 / 8133 未被占用"
}

# 6. 跨机协同网络与双模型链路自检
action_check_network() {
  local mac_ip
  mac_ip=$(get_mac_node_ip)
  local vps_target
  vps_target=$(get_vps_ssh_target)

  echo -e "\n${BOLD}=== [1/4] 本机算力节点网络状态 ===${NC}"
  echo -e "本机 IP: ${BOLD}${mac_ip}${NC}"

  echo -e "\n${BOLD}=== [2/4] Ping VPS 目标节点 (${vps_target}) ===${NC}"
  if ping -c 2 -W 1500 "${vps_target}" >/dev/null 2>&1; then
    echo -e "${GREEN}✓ VPS 网络直连正常！${NC}"
  else
    echo -e "${YELLOW}⚠️ 无法直接 Ping 通 VPS (${vps_target})，可能开启了 ICMP 禁 ping，继续探测 SSH...${NC}"
  fi

  echo -e "\n${BOLD}=== [3/4] 验证 VPS 跨网反向调用 Mac 8132 & 8133 ===${NC}"
  if ssh -o ConnectTimeout=3 -o BatchMode=yes "${VPS_USER}@${vps_target}" "echo OK" >/dev/null 2>&1; then
    echo -e "SSH 登录 VPS 成功，正在从 VPS 发起反向探测..."
    local vps_test_s2
    vps_test_s2=$(ssh -o ConnectTimeout=5 "${VPS_USER}@${vps_target}" "curl -s -m 4 http://${mac_ip}:8132/health | grep -o '\"status\":\"ok\"' || echo FAIL")
    local vps_test_embed
    vps_test_embed=$(ssh -o ConnectTimeout=5 "${VPS_USER}@${vps_target}" "curl -s -m 4 http://${mac_ip}:8133/health | grep -o '\"status\":\"ok\"' || echo FAIL")

    if [ "${vps_test_s2}" = '"status":"ok"' ]; then
      echo -e "${GREEN}✓ VPS 成功直连 Mac 8132 (System-2 27B)！${NC}"
    else
      echo -e "${RED}✖ VPS 无法访问 Mac 8132，请检查端口是否为 0.0.0.0 监听。${NC}"
    fi

    if [ "${vps_test_embed}" = '"status":"ok"' ]; then
      echo -e "${GREEN}✓ VPS 成功直连 Mac 8133 (Civic-Embed bge-m3)！${NC}"
    else
      echo -e "${RED}✖ VPS 无法访问 Mac 8133，请检查端口是否为 0.0.0.0 监听。${NC}"
    fi

    local vps_test_win_s2
    vps_test_win_s2=$(ssh -o ConnectTimeout=5 "${VPS_USER}@${vps_target}" "curl -s -m 4 http://${WIN_TS_IP}:8091/v1/models | grep -o '\"id\":\"bonsai-2-27b\"' || echo FAIL")
    local vps_test_win_embed
    vps_test_win_embed=$(ssh -o ConnectTimeout=5 "${VPS_USER}@${vps_target}" "curl -s -m 4 http://${WIN_TS_IP}:8133/health | grep -o '\"status\":\"ok\"' || echo FAIL")

    if [ "${vps_test_win_s2}" = '"id":"bonsai-2-27b"' ]; then
      echo -e "${GREEN}✓ VPS 成功直连 Win 8091 (RTX GPU Bonsai-2 27B)！${NC}"
    else
      echo -e "${YELLOW}⚠️ VPS 无法访问 Win 8091，请检查 Windows ninfer 服务是否在线。${NC}"
    fi

    if [ "${vps_test_win_embed}" = '"status":"ok"' ]; then
      echo -e "${GREEN}✓ VPS 成功直连 Win 8133 (BGE-M3 向量嵌入服务)！${NC}"
    else
      echo -e "${YELLOW}⚠️ VPS 无法访问 Win 8133，请检查 Windows BgeM3Embedding 计划任务。${NC}"
    fi
  else
    echo -e "${YELLOW}⚠️ 无法无密 SSH 连接到 ${VPS_USER}@${vps_target}，跳过云端反向探测。${NC}"
  fi

  echo -e "\n${BOLD}=== [4/4] 探测生产站健康 (${PROD_DOMAIN}) ===${NC}"
  local http_code
  http_code=$(curl -s -o /dev/null -w "%{http_code}" -m 5 "${PROD_DOMAIN}" || echo "000")
  if [ "${http_code}" = "200" ] || [ "${http_code}" = "307" ] || [ "${http_code}" = "308" ]; then
    echo -e "${GREEN}✓ 生产站在线正常 (HTTP ${http_code}) -> ${PROD_DOMAIN}${NC}"
  else
    echo -e "${YELLOW}⚠️ 生产站返回异常 (HTTP ${http_code})${NC}"
  fi
}

# 7. 一键同步 .env.vps 并热重载 VPS
action_sync_vps() {
  local vps_target
  vps_target=$(get_vps_ssh_target)

  echo -e "\n${BOLD}>>> [1/3] 上传 .env.vps 到 VPS (${VPS_USER}@${vps_target}:${VPS_STACK_DIR}/.env.vps)...${NC}"
  if [ ! -f ".env.vps" ]; then
    echo -e "${RED}错误：本地未找到 .env.vps 文件！${NC}"
    return 1
  fi

  scp -o ConnectTimeout=5 .env.vps "${VPS_USER}@${vps_target}:${VPS_STACK_DIR}/.env.vps"
  if [ $? -ne 0 ]; then
    echo -e "${RED}上传失败，请检查 SSH 连通性。${NC}"
    return 1
  fi
  echo -e "${GREEN}✓ 配置上传成功！${NC}"

  echo -e "\n${BOLD}>>> [2/3] 热重载 VPS 上的 12345-app 容器环境...${NC}"
  ssh -o ConnectTimeout=5 "${VPS_USER}@${vps_target}" "cd ${VPS_STACK_DIR} && docker compose --env-file .env.vps up -d app && docker restart langgraph-app-caddy-1 2>/dev/null || true"

  echo -e "\n${BOLD}>>> [3/3] 验证生产端响应...${NC}"
  sleep 2
  local http_code
  http_code=$(curl -s -o /dev/null -w "%{http_code}" -m 5 "${PROD_DOMAIN}")
  echo -e "${GREEN}✓ VPS 部署已更新并重载，站点状态: HTTP ${http_code}${NC}"
}

# 8. 跨机数据库双向热同步 (Mac <-> VPS)
action_sync_db() {
  bash "${SCRIPT_DIR}/sync-db.sh" "$@"
}

# 9. 快速单条工单端到端研判测试
action_test_inference() {
  echo -e "\n${BOLD}=== 12345 诉求智能研判交互测试 (System-2 27B) ===${NC}"
  echo -e "请输入需要研判的市民诉求文本（直接回车将使用默认天河区占道经营测试）："
  read -r -p "工单诉求 > " user_input
  if [ -z "${user_input}" ]; then
    user_input="市民反映：天河区体育西路地铁站出口周边有多家流动商贩占道经营，高音喇叭叫卖严重扰民，影响行人通行。请研判诉求类型与责任归属。"
  fi

  echo -e "\n${CYAN}>>> 正在发送请求至本地 System-2 (http://127.0.0.1:8132/v1)...${NC}"
  node -e "
    const http = require('http');
    const payload = JSON.stringify({
      model: 'bonsai-2-27b',
      messages: [
        {
          role: 'system',
          content: '你是 12345 政务便民热线智能分析中枢。请根据市民诉求，给出【研判摘要】、【责任职能局】、【核心标签】。严格简洁专业。'
        },
        { role: 'user', content: process.argv[1] }
      ],
      temperature: 0.1,
      max_tokens: 300
    });
    const req = http.request({
      hostname: '127.0.0.1',
      port: 8132,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const reply = json.choices && json.choices[0] ? json.choices[0].message.content : data;
          console.log('\n\x1b[1m\x1b[32m--- 🤖 System-2 研判结果 ---\x1b[0m\n' + reply + '\n');
        } catch (e) {
          console.log('响应解析异常:\n', data);
        }
      });
    });
    req.on('error', err => console.error('\x1b[31m请求失败: ' + err.message + '\x1b[0m'));
    req.write(payload);
    req.end();
  " "${user_input}"
}

# 10. 快速测试 Civic-Embed 向量嵌入
action_test_embedding() {
  echo -e "\n${BOLD}=== Civic-Embed 密集向量特征提取测试 (bge-m3) ===${NC}"
  echo -e "请输入测试词句（直接回车使用默认政务词汇）："
  read -r -p "文本输入 > " embed_input
  if [ -z "${embed_input}" ]; then
    embed_input="天河区市容环卫流动商贩管理"
  fi

  echo -e "\n${CYAN}>>> 正在请求本地 Embed 服务 (http://127.0.0.1:8133/v1)...${NC}"
  node -e "
    const http = require('http');
    const payload = JSON.stringify({
      model: 'BAAI/bge-m3',
      input: process.argv[1]
    });
    const req = http.request({
      hostname: '127.0.0.1',
      port: 8133,
      path: '/v1/embeddings',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const vec = json.data[0].embedding;
          console.log('\n\x1b[1m\x1b[32m✓ 向量化成功！\x1b[0m');
          console.log('• 模型名称: ' + json.model);
          console.log('• 向量维度: ' + vec.length + ' 维');
          console.log('• 特征前 8 位采样: [' + vec.slice(0, 8).map(x => x.toFixed(5)).join(', ') + ', ...]\n');
        } catch (e) {
          console.log('响应解析异常:\n', data);
        }
      });
    });
    req.on('error', err => console.error('\x1b[31m请求失败: ' + err.message + '\x1b[0m'));
    req.write(payload);
    req.end();
  " "${embed_input}"
}

# 11. 启动本地全栈开发环境
action_start_local_dev() {
  echo -e "\n${BOLD}>>> 启动本地前端开发服务器 (Next.js)...${NC}"
  pnpm dev
}

# 12. 打开数据库管理后台
action_db_studio() {
  echo -e "\n${BOLD}>>> 正在启动 Drizzle Studio 数据可视化后台...${NC}"
  pnpm db:studio
}

# 13. 数据库与词汇管理子菜单
action_db_menu() {
  while true; do
    echo -e "\n${CYAN}------------------------------------------------------------------------------${NC}"
    echo -e "${BOLD}  🗄️  数据库与政务知识库管理${NC}"
    echo -e "${CYAN}------------------------------------------------------------------------------${NC}"
    echo -e "  [1] 初始化数据库结构 (db:init)"
    echo -e "  [2] 初始化超级管理员账号 (db:init-admin)"
    echo -e "  [3] 初始化多租户行政区划 (db:init-tenants)"
    echo -e "  [4] 导入预设政务词汇表 (db:vocab)"
    echo -e "  [5] 一键热同步全量数据库至 VPS (db:sync-vps)"
    echo -e "  [0] 返回上级菜单"
    echo -e "${CYAN}------------------------------------------------------------------------------${NC}"
    read -r -p "请选择操作 [0-5]: " db_choice
    case "${db_choice}" in
      1) pnpm db:init ;;
      2) pnpm db:init-admin ;;
      3) pnpm db:init-tenants ;;
      4) pnpm db:vocab ;;
      5) action_sync_db ;;
      0) break ;;
      *) echo -e "${RED}无效选项${NC}" ;;
    esac
    echo -e "\n按回车键继续..."
    read -r
  done
}

# 14. 开机自启配置引导
action_startup_guide() {
  echo -e "\n${BOLD}=== PM2 开机自启动配置管理 ===${NC}"
  echo -e "在 macOS 下，PM2 可以生成 Launchd 守护脚本，实现开机自动唤起推理服务。\n"
  echo -e "1. 开启开机自启："
  echo -e "   运行：${CYAN}pm2 startup${NC}"
  echo -e "   然后复制控制台提示的那条 ${BOLD}sudo env PATH=... pm2 startup darwin ...${NC} 执行即可。\n"
  echo -e "2. 取消开机自启："
  echo -e "   运行：${CYAN}pm2 unstartup${NC}\n"
  echo -e "当前已保存的 PM2 进程列表："
  pm2 list
}

# ------------------------------------------------------------------------------
# 主入口与菜单调度
# ------------------------------------------------------------------------------
main() {
  # CLI 快捷参数分发（支持非交互脚本与 CI 调用）
  if [ -n "$1" ]; then
    case "$1" in
      sync-db|db:sync|db:sync-vps)
        shift
        action_sync_db "$@"
        exit $?
        ;;
      sync-env|sync-vps)
        action_sync_vps
        exit $?
        ;;
      start)
        action_start_pm2
        exit $?
        ;;
      stop)
        action_stop_pm2
        exit $?
        ;;
      restart)
        action_restart_pm2
        exit $?
        ;;
      check|test)
        action_check_network
        exit $?
        ;;
      logs)
        action_view_logs
        exit $?
        ;;
      status)
        action_view_metrics
        exit $?
        ;;
      dev)
        action_start_local_dev
        exit $?
        ;;
      studio)
        action_db_studio
        exit $?
        ;;
      *)
        # 未匹配则继续进入交互菜单
        ;;
    esac
  fi

  while true; do
    show_header
    echo -e "\n${BOLD}【 推理集群常驻运维 (PM2 / Apple Silicon) 】${NC}"
    echo -e "  ${GREEN}1)${NC} 启动/常驻 PM2 双推理服务    ${CYAN}(清理端口 -> 启动 PM2 -> 保存配置 -> 就绪自检)${NC}"
    echo -e "  ${RED}2)${NC} 停止/释放 PM2 双推理服务    ${CYAN}(停止进程 -> 释放 Metal 显存与 8132/8133 端口)${NC}"
    echo -e "  ${YELLOW}3)${NC} 重启 PM2 双推理服务          ${CYAN}(平滑重载)${NC}"
    echo -e "  ${BLUE}4)${NC} 查看推理实时日志            ${CYAN}(pm2 logs civic-s2 civic-embed)${NC}"
    echo -e "  ${PURPLE}5)${NC} 查看模型进程与显存占用      ${CYAN}(Metal 吞吐与内存统计)${NC}"

    echo -e "\n${BOLD}【 跨机协同与 VPS 联调 】${NC}"
    echo -e "  ${CYAN}6)${NC} 跨机网络与模型链路自检      ${CYAN}(自适应 IP / 双向模型探针 / 生产站健康)${NC}"
    echo -e "  ${CYAN}7)${NC} 同步配置并重启 VPS 容器     ${CYAN}(上传 .env.vps -> 重启 Docker 生产服务)${NC}"
    echo -e "  ${GREEN}8)${NC} 一键热同步全量数据库至 VPS  ${CYAN}(流式推送 22 万+ 工单/主题到 VPS)${NC}"

    echo -e "\n${BOLD}【 12345 核心功能与测试 】${NC}"
    echo -e "  ${BOLD}9)${NC} 发起单条市民工单端到端研判  ${CYAN}(调用本地 System-2 27B 输出标准政务研判)${NC}"
    echo -e " ${BOLD}10)${NC} 测试 Civic-Embed 向量嵌入   ${CYAN}(调用本地 bge-m3 计算 1024 维特征)${NC}"
    echo -e " 11) 启动本地全栈开发环境        ${CYAN}(pnpm dev)${NC}"
    echo -e " 12) 打开 Drizzle Studio 数据库  ${CYAN}(本地可视化管理)${NC}"
    echo -e " 13) 数据库与政务知识库管理      ${CYAN}(初始化/词表/租户/同步)${NC}"

    echo -e "\n${BOLD}【 系统设置 】${NC}"
    echo -e " 14) 配置 Mac 开机自启动         ${CYAN}(PM2 Startup 托管指引)${NC}"
    echo -e "  0) 退出控制台"
    echo -e "${CYAN}================================================================================${NC}"

    if ! read -r -p "请输入选项 [0-14]: " choice; then
      echo -e "\n检测到输入流结束，退出控制台。"
      exit 0
    fi
    case "${choice}" in
      1) action_start_pm2 ;;
      2) action_stop_pm2 ;;
      3) action_restart_pm2 ;;
      4) action_view_logs ;;
      5) action_view_metrics ;;
      6) action_check_network ;;
      7) action_sync_vps ;;
      8) action_sync_db ;;
      9) action_test_inference ;;
      10) action_test_embedding ;;
      11) action_start_local_dev ;;
      12) action_db_studio ;;
      13) action_db_menu ;;
      14) action_startup_guide ;;
      0|q|exit) echo -e "\n👋 祝研发顺利，再见！\n"; exit 0 ;;
      *) echo -e "\n${RED}无效选项，请输入 0-14 之间的数字${NC}" ;;
    esac

    echo -e "\n${CYAN}------------------------------------------------------------------------------${NC}"
    read -r -p "按回车键返回主菜单..." _ || exit 0
  done
}

main "$@"
