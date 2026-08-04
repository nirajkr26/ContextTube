# Stage 1: Install dependencies
FROM oven/bun:alpine AS deps
WORKDIR /app

# Copy package management files
COPY package.json bun.lock ./

# Install project dependencies
RUN bun install --frozen-lockfile

# Stage 2: Build the Next.js application
FROM oven/bun:alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Set environment variables for compilation
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV DATABASE_URL="postgres://dummy:dummy@localhost:5432/dummy"
ENV GEMINI_API_KEY="dummy-gemini-key"
ENV QSTASH_TOKEN="dummy-qstash-token"

# Compile and build Next.js application
RUN bun run build

# Stage 3: Production runner stage
FROM oven/bun:alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Copy package and configuration files
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 3000

CMD ["bun", "run", "start"]
