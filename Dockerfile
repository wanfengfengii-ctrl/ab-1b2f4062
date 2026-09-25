# syntax=docker/dockerfile:1

# ---------- 公共基础：安装依赖 + 源码 ----------
FROM node:22-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .

# ---------- verify：一次性校验服务 ----------
# 运行逻辑校验（单元测试）→ 生产构建 → 页面可访问检查，
# 完成后自行退出，退出码即校验结果（0=通过，非 0=失败）。
FROM base AS verify
CMD ["sh", "scripts/verify.sh"]

# ---------- 生产构建 ----------
FROM base AS build
RUN npm run build

# ---------- web：静态站点 ----------
FROM nginx:1.27-alpine AS web
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --retries=5 --start-period=5s \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
