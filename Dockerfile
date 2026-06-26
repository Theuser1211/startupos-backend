FROM node:22-alpine AS builder

WORKDIR /app

RUN apk add --no-cache python3 make g++ openssl

COPY package.json package-lock.json ./

COPY apps/backend/package.json apps/backend/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN npm ci --omit=optional

COPY packages/shared/ packages/shared/
RUN npm run build -w packages/shared

COPY apps/backend/ apps/backend/
RUN npx prisma generate --schema=apps/backend/prisma/schema.prisma
RUN npm run build -w apps/backend


FROM node:22-alpine AS runner

WORKDIR /app/apps/backend

RUN apk add --no-cache openssl wget

ENV NODE_ENV=production

COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/packages/shared /app/packages/shared
COPY --from=builder /app/apps/backend/dist ./dist
COPY --from=builder /app/apps/backend/prisma ./prisma
COPY --from=builder /app/apps/backend/docker-entrypoint.sh ./docker-entrypoint.sh

RUN chmod +x docker-entrypoint.sh

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
