# Tochi Voice Gateway

An Express and Prisma service for managing device installations and issuing credentials for the Tochi voice gateway.

## Current scope

Implemented:

- `GET /health`
- Installation registration for Android and iOS
- Access-token authentication with 15-minute JWTs
- Refresh-credential rotation
- Installation lookup and revocation
- PostgreSQL persistence through Prisma

Voice requests, quota enforcement, idempotency handling, and upload validation are reserved for a later implementation. The corresponding source files are currently placeholders.

## Requirements

- Node.js 20 or newer
- pnpm 12.3.4
- PostgreSQL 16 or newer

The repository declares pnpm through Corepack. Enable it once if needed:

```bash
corepack enable
corepack prepare pnpm@12.3.4 --activate
```

## Configuration

Create a `.env` file in the project root:

```dotenv
DB_USER=tochi
DB_PASSWORD=change-me
DB_NAME=tochi_voice
DB_PORT=5432
DATABASE_URL=postgresql://tochi:change-me@localhost:5432/tochi_voice?schema=public
JWT_SIGNING_SECRET=replace-with-a-long-random-secret
PORT=3000
```

`DATABASE_URL`, `JWT_SIGNING_SECRET`, and `PORT` are used by the application. `DB_USER`, `DB_PASSWORD`, `DB_NAME`, and `DB_PORT` are used by Docker Compose and should match the local database connection in `DATABASE_URL`.

The server loads `.env` automatically when it starts.

Do not commit `.env` or expose `JWT_SIGNING_SECRET`. Refresh credentials are returned only at registration or refresh time and should be stored securely by the client.

## Local development

Install dependencies, generate the Prisma client, and apply the development migration:

```bash
pnpm install
pnpm prisma:generate
pnpm prisma:migrate
```

Start the development server with automatic restart:

```bash
pnpm dev
```

The service listens on `http://localhost:3000` by default. For a production-style run:

```bash
pnpm build
pnpm start
```

## Docker Compose

Docker Compose starts PostgreSQL and the application together. Set the variables used by `docker-compose.yml` in `.env`, then run:

```bash
docker compose up --build
```

The application container runs pending Prisma migrations before starting the server. Stop the stack with:

```bash
docker compose down
```

Add `-v` only when you intentionally want to remove the PostgreSQL data volume.

## API

### Health check

```bash
curl http://localhost:3000/health
```

Response:

```json
{"status":"ok"}
```

### Register an installation

```bash
curl -X POST http://localhost:3000/v1/installations/register \
  -H 'Content-Type: application/json' \
  -d '{"platform":"ANDROID"}'
```

`platform` must be `ANDROID` or `IOS`. A successful response contains an installation ID, an access token, a refresh credential, and the initial `UNVERIFIED` quota tier:

```json
{
  "installationId": "...",
  "accessToken": "...",
  "refreshCredential": "...",
  "quotaTier": "UNVERIFIED"
}
```

### Refresh credentials

```bash
curl -X POST http://localhost:3000/v1/installations/refresh \
  -H 'Content-Type: application/json' \
  -d '{"refreshCredential":"..."}'
```

Refreshing rotates the credential. Replace the stored refresh credential with the one returned by this endpoint. A missing, invalid, or revoked credential returns `401`.

### Get the current installation

```bash
curl http://localhost:3000/v1/installations/me \
  -H 'Authorization: Bearer ACCESS_TOKEN'
```

### Revoke the current installation

```bash
curl -X DELETE http://localhost:3000/v1/installations/me \
  -H 'Authorization: Bearer ACCESS_TOKEN'
```

Successful revocation returns `204 No Content`. The access-token middleware returns `401` when the bearer token is missing, invalid, or expired.

## Project commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Run the development server with reloads |
| `pnpm build` | Compile TypeScript to `dist/` |
| `pnpm start` | Run the compiled server |
| `pnpm prisma:generate` | Generate the Prisma client |
| `pnpm prisma:migrate` | Create/apply a development migration |

## License

This project currently uses the ISC license declared in `package.json`.