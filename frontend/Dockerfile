# syntax=docker/dockerfile:1

# Next.js 16, built to a standalone server (see `output` in next.config.ts):
# the runtime image carries a self-contained server.js plus only the node_modules
# it actually traced, so it ships without the toolchain that built it.

# ---- deps -------------------------------------------------------------------
# Split from the build so a source-only edit reuses the install layer.
FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- build ------------------------------------------------------------------
FROM node:22-alpine AS builder
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* is inlined into the client bundle at BUILD time, not read at
# runtime — so the voice API URL has to arrive here as a build arg. Compose
# passes it from .env; change it there and rebuild, not just restart.
ARG NEXT_PUBLIC_VOICE_API_URL
ENV NEXT_PUBLIC_VOICE_API_URL=${NEXT_PUBLIC_VOICE_API_URL}

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN npm run build

# ---- runtime ----------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Unprivileged: nothing in the request path needs to write to the filesystem.
RUN addgroup -g 1001 -S nodejs \
    && adduser -S -u 1001 -G nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
# Static assets live outside the traced bundle and have to be copied alongside.
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

# Documentation only — the published port is set by compose from .env.
EXPOSE 3000

# server.js reads PORT/HOSTNAME from the environment, so the same image serves
# whatever port .env names.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
