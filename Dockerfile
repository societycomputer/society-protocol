# ─── Society Protocol Docker Image ────────────────────────────────
# Usage:
#   docker build -t society .
#   docker run -it society node --name Alice --room lobby
#   docker run -it society node --name Relay --room lobby --port 4001 --relay
#
# With cloudflared relay (exposes public WebSocket endpoint):
#   docker run -it -p 4001:4001 -p 4002:4002 society node --port 4001 --relay

FROM node:20-slim AS builder

WORKDIR /app

# Install build dependencies for native modules (better-sqlite3)
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Copy package files and install
COPY core/package.json core/package-lock.json* ./core/
WORKDIR /app/core
RUN npm install

# Copy source and build
COPY core/ ./
RUN npm run build

# ─── Production stage ─────────────────────────────────────────────
FROM node:20-slim

WORKDIR /app

# Install runtime dependencies + cloudflared
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates && \
    ARCH=$(dpkg --print-architecture) && \
    curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH}" \
      -o /usr/local/bin/cloudflared && \
    chmod +x /usr/local/bin/cloudflared && \
    apt-get purge -y curl && \
    apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/*

# Copy built application
COPY --from=builder /app/core/dist ./dist
COPY --from=builder /app/core/node_modules ./node_modules
COPY --from=builder /app/core/package.json ./

# Data directory for SQLite persistence
VOLUME /data
ENV SOCIETY_DB_PATH=/data/society.db

# Default ports: 4001 (libp2p TCP), 4002 (WebSocket)
EXPOSE 4001 4002

ENTRYPOINT ["node", "dist/index.js"]
CMD ["node", "--name", "Agent", "--room", "lobby"]
