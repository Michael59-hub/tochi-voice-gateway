FROM node:20-alpine

# Required for Prisma's query engine on Alpine Linux
RUN apk add --no-cache openssl

WORKDIR /app

# Install pnpm 12.3.4 directly to bypass Corepack download hangs
RUN npm install -g pnpm@12.3.4

# Set network resilience for pnpm
RUN pnpm config set fetch-timeout 600000 && \
    pnpm config set fetch-retries 5

COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* ./
COPY prisma ./prisma/

# Disable the hanging postinstall script
ENV PRISMA_SKIP_POSTINSTALL_GENERATE=true

# Bypass pnpm 12 strict build blocking and mount BuildKit store cache
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --config.strict-dep-builds=false

RUN pnpm exec prisma generate

COPY . .

RUN pnpm build

EXPOSE 3000

CMD ["pnpm", "start"]