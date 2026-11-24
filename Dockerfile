# syntax=docker/dockerfile:1.7
# Next.js 15 + LangGraph JS 全栈应用 (民声智理 · 顺德 12345 AI 智能研判系统)

ARG NODE_VERSION=22

# ---------- base: pnpm via corepack ----------
# 使用 Debian slim (glibc)，保证 onnxruntime-node 原生 Linux x64 推理库与模型可在生产容器正常加载
FROM node:${NODE_VERSION}-slim AS base
ENV PNPM_HOME="/pnpm" PATH="/pnpm:$PATH"
# pin pnpm@9: pnpm 10+ 移走了 package.json 里的 pnpm.onlyBuiltDependencies (新家是 pnpm-workspace.yaml)
# 本项目在 package.json 里写 onlyBuiltDependencies, 必须用 pnpm 9.x 才生效
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

# ---------- deps: install all deps for build ----------
FROM base AS deps
COPY package.json pnpm-lock.yaml .npmrc* ./
# 去掉 --frozen-lockfile, 让 pnpm install 自己写 approval 到 lockfile + 跑 build scripts
# (onlyBuiltDependencies 在 package.json 里, pnpm v9 会自动 approve 并跑 esbuild/sharp postinstall)
# 加 --reporter=silent 减少 WARN 输出 (那些都是 metadata 拉取延迟, 不是真实错误)
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --reporter=silent

# ---------- build: next build ----------
FROM deps AS build
COPY . .
RUN if [ -f .env.vps ] && [ ! -f .env.production ]; then cp .env.vps .env.production; fi
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build
# System-1 ONNXAdapter 通过动态 import('onnxruntime-node') 加载，@vercel/nft 不会自动追踪；
# 将真实目录与 onnxruntime-common 实体拷贝进 standalone/node_modules，并剔除非 linux 二进制缩小体积。
RUN node -e '\
  const fs = require("fs"), path = require("path"); \
  const ortPkg = require.resolve("onnxruntime-node/package.json", { paths: [process.cwd(), path.join(process.cwd(), "packages/civic-system-one")] }); \
  const ortNode = fs.realpathSync(path.dirname(ortPkg)); \
  const ortCommon = fs.realpathSync(path.join(path.dirname(ortNode), "onnxruntime-common")); \
  fs.cpSync(ortNode, ".next/standalone/node_modules/onnxruntime-node", { recursive: true, dereference: true }); \
  fs.cpSync(ortCommon, ".next/standalone/node_modules/onnxruntime-common", { recursive: true, dereference: true }); \
  for (const plat of ["darwin", "win32"]) { \
    fs.rmSync(path.join(".next/standalone/node_modules/onnxruntime-node/bin/napi-v6", plat), { recursive: true, force: true }); \
  } \
'

# ---------- migrate: drizzle migrator (one-off, not in final image) ----------
# 用法: docker run --rm --network 12345_default --env-file .env.local \
#        -e DATABASE_URL=... minsheng-zhili:migrate
# 独立 stage: 不会污染 runtime 镜像 (standalone 不需要 tsx)
FROM deps AS migrate
WORKDIR /app
COPY --from=build /app/db ./db
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/package.json ./package.json
CMD ["pnpm", "db:migrate"]

# ---------- runner: production image ----------
FROM base AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3100 \
    HOSTNAME=0.0.0.0

RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates libgomp1 && \
    rm -rf /var/lib/apt/lists/* && \
    groupadd -g 1001 -r nodejs && \
    useradd -r -u 1001 -g nodejs nextjs

# public assets & ONNX System-1 model weights + vocab
COPY --from=build /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/packages/civic-system-one/models/civic-laya-onnx ./packages/civic-system-one/models/civic-laya-onnx
COPY --from=build --chown=nextjs:nodejs /app/packages/civic-system-one/models/vocab_civic.json ./packages/civic-system-one/models/vocab_civic.json
# standalone server (preferred minimal runtime, includes onnxruntime-node)
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3100

# healthcheck against Next.js root
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3100/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]