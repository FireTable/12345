# syntax=docker/dockerfile:1.7
# Next.js 15 + LangGraph JS 全栈应用 (民声智理 · 顺德 12345 AI 智能研判系统)

ARG NODE_VERSION=22

# ---------- base: pnpm via corepack ----------
FROM node:${NODE_VERSION}-alpine AS base
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
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

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

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# public assets
COPY --from=build /app/public ./public
# standalone server (preferred minimal runtime)
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3100

# healthcheck against Next.js root
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3100/ >/dev/null || exit 1

CMD ["node", "server.js"]