# Clawify TEE Bootstrap Container
# This container runs inside a TEE and bootstraps OpenClaw with wallet access

FROM node:22-slim

# Install required system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    git \
    ca-certificates \
    python3 \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files first for better caching
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm install

# Copy source files
COPY src/ ./src/
COPY tsconfig.json ./

# Build TypeScript
RUN npm run build

# Create openclaw directories
RUN mkdir -p /root/.openclaw/workspace /root/.openclaw/agents/default

# Environment variables (will be overridden at runtime)
ENV NODE_ENV=production
ENV HOME=/root

# Health check - verify the process is running
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD pgrep -f "node dist/index.js" > /dev/null || exit 1

# Run the bootstrap process
CMD ["npm", "start"]
