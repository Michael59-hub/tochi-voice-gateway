FROM node:20-alpine

RUN apk add --no-cache openssl

WORKDIR /app

# Pin pnpm to 12 
RUN corepack enable && corepack prepare pnpm@12 --activate

COPY package.json pnpm-lock.yaml* ./
COPY prisma ./prisma/

RUN pnpm install --frozen-lockfile

RUN pnpm exec prisma generate

COPY . .

RUN pnpm build

EXPOSE 3000

CMD ["pnpm", "start"]