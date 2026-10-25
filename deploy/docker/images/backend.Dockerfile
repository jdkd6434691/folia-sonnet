FROM node:24-alpine AS api-builder

WORKDIR /app

# 根 devDependencies 里有需编译的原生模块（better-sqlite3，供根目录单测用）：alpine 上先装构建工具。
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json .npmrc ./
RUN npm ci

COPY api-ts ./api-ts
COPY shared ./shared
RUN npm run build:vercel-api

FROM node:24-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY deploy/docker/backend/package.json deploy/docker/backend/package-lock.json ./
RUN npm ci --omit=dev

COPY --from=api-builder /app/api ./api
COPY shared ./shared
COPY deploy/docker/backend/server.mjs ./server.mjs

USER node
EXPOSE 3000

CMD ["node", "server.mjs"]
