---
noteId: "66e4fdb06c5111f19a1d27ff79f85615"
tags: []

---

# Deployment Final Audit — Railway + Supabase

## Audit Result: PASS

Every issue found during the audit has been fixed. The application is ready for zero-error deployment on Railway.

---

## 1. Prisma Schema — `prisma/schema.prisma`

| Check | Status |
|---|---|
| `directUrl` support for Supabase pooler | ✅ Fixed |
| PostgreSQL provider | ✅ Correct |

**What was wrong:** `directUrl` was missing. Supabase's PgBouncer pooler (port 6543) does not support DDL statements. Prisma Migrate / `prisma db push` needs a direct connection (port 5432) to run schema changes.

**What was done:** Added `directUrl = env("DIRECT_URL")` to the `datasource db` block.

---

## 2. Application Startup — `src/server.ts`

| Check | Status |
|---|---|
| Database health-checked before server listens | ✅ Fixed |
| Fail-fast on DB unreachable | ✅ Fixed |
| Redis health-checked before worker starts | ✅ Fixed |
| Fail-fast on Redis unreachable | ✅ Fixed |
| `/health` endpoint reflects DB status | ✅ Fixed |

**What was wrong:** The server started listening before verifying the database was reachable. If the DB was down, it would only fail on the first query, leaving the server running in a degraded state. Redis connectivity was not checked at all.

**What was done:**
- Added `checkDatabase()` — runs `SELECT 1` via Prisma and calls `process.exit(1)` on failure
- Added `checkRedis()` — connects to Redis, runs `PING`, and calls `process.exit(1)` on failure
- Both checks run before `app.listen()` and before `startWorker()`
- `/health` endpoint now pings the database and returns `database: "ok"` or `"error"`

---

## 3. Redis / Worker — `src/queue/`

| Check | Status |
|---|---|
| Worker connection errors handled | ✅ Already adequate |
| Worker fail-fast when Redis is down | ✅ Fixed (via `checkRedis` in bootstrap) |

**What was wrong:** The worker was created with `maxRetriesPerRequest: null`, which means BullMQ will retry indefinitely if Redis is unreachable — no immediate error surfaced during startup.

**What was done:** Pre-flight Redis connectivity check in `bootstrap()` prevents the server from starting (and the worker from being created) if Redis is unreachable.

---

## 4. Dockerfile

| Check | Status |
|---|---|
| `prisma generate` runs during build | ✅ Already present |
| Build output goes to `dist/` | ✅ Correct |
| Use `npm ci` instead of `npm install` | ✅ Fixed |
| `HEALTHCHECK` instruction present | ✅ Added |
| Multi-stage build to minimize image size | ✅ Already present |

**What was wrong:** Used `npm install` (non-deterministic) instead of `npm ci`. No Docker `HEALTHCHECK` — Railway could not detect liveness.

**What was done:**
- Changed `npm install` to `npm ci --omit=optional` for deterministic, faster installs
- Moved `prisma generate` earlier so it runs before `COPY . .` for better layer caching
- Added `HEALTHCHECK` with `wget` hitting `/health`

---

## 5. Railway Deployment Readiness

| Check | Status |
|---|---|
| `railway.toml` present | ✅ Created |
| Health check path configured | ✅ `/health` |
| Docker deployment kind | ✅ |
| Restart policy configured | ✅ |
| `DIRECT_URL` documented in `.env.deploy` | ✅ Fixed |

**What was wrong:** No `railway.toml` existed. Railway uses this to detect the service port, health check path, and restart policy.

**What was done:** Created `railway.toml` with:
```toml
[deploy]
kind = "docker"
healthcheckPath = "/health"
healthcheckTimeout = 10
restartPolicyType = "always"
restartPolicyMaxRetries = 5

[service]
port = 3000
```

---

## Verification

| Step | Result |
|---|---|
| `tsc --noEmit` (typecheck) | ✅ Passed |
| `vitest run` (30 tests) | ✅ Passed |
| `npm run build` (esbuild) | ✅ Passed |

---

## Required Environment Variables (Railway)

Set these in Railway dashboard → Variables:

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | ✅ | Supabase pooler URL (port 6543, `?pgbouncer=true`) |
| `DIRECT_URL` | ✅ | Supabase direct URL (port 5432, no pooler) |
| `JWT_SECRET` | ✅ | Min 32 chars |
| `REDIS_URL` | ⚠️ | Required for job queue (Upstash with `rediss://`) |
| `NODE_ENV` | ✅ | Set to `production` |
| `JOB_TIMEOUT_MS` | | Default 600000 |
| `JOB_MONITOR_INTERVAL_MS` | | Default 30000 |
| `LOG_LEVEL` | | Default `info` |

---

## Startup Sequence (Expected on Railway)

```
1. Docker container starts
2. Prisma client is already generated (Docker build step)
3. Env vars validated (src/lib/env.ts) — exit if invalid
4. Database ping (SELECT 1) — exit if unreachable
5. Redis ping — exit if unreachable
6. Fastify server starts listening on 0.0.0.0:3000
7. BullMQ worker starts
8. Job timeout monitor starts
9. Railway health check hits /health → 200
=> ZERO startup errors
```