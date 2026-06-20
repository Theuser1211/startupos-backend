# StartupOS Backend — Critical Issues

---

## 🔴 SEV-01: Secrets Hardcoded in Repository
**Files:** `.env`, `.env.deploy`, `docker-compose.yml`
**Severity:** **CRITICAL** | **Impact:** Complete compromise of all external services | **Fix effort:** 30 min

Every real credential is committed to the repo:
- `GROQ_API_KEY` (line 18 of `.env`)
- `FREELLM_API_KEY` (line 19 of `.env`)
- `VERCEL_TOKEN` (line 22 of `.env`)
- `JWT_SECRET` (line 11 of `.env` — dev-only but weak)
- `SUPABASE_SERVICE_KEY` (line 15 of `.env` — full admin access to Supabase)
- `DATABASE_URL` with real password (line 5 of `.env`)
- `REDIS_URL` with Upstash password (line 9 of `.env`)
- `VERCEL_TOKEN` duplicated in `.env.deploy` (line 79)
- Same secrets in `docker-compose.yml` (line 28: `JWT_SECRET`)

**Fix:** Rotate all secrets immediately. Move to environment variables or secret manager. Add `.env` and `.env.deploy` to `.gitignore` (already present). Purge from git history.

---

## 🔴 SEV-02: No Zod Runtime Validation on Any Request Handler
**Files:** `src/modules/auth/auth.handler.ts`, `src/modules/startups/startup.handler.ts`, `src/modules/blueprints/blueprint.handler.ts`, `src/modules/websites/website.handler.ts`, `src/modules/deployments/deployment.handler.ts`
**Severity:** **CRITICAL** | **Impact:** All handlers accept unvalidated/malformed data | **Fix effort:** 2 hours

Every module defines Zod schemas but **never calls them at runtime**. Handlers rely solely on Fastify's built-in JSON schema validation, which:
- Does not validate string lengths (except `minLength` in route schemas)
- Does not strip unknown fields
- Does not provide typed Zod errors
- Cannot do refinements, transforms, or complex cross-field validation

Example: `src/modules/auth/auth.handler.ts:12` uses `RegisterInput` type (inferred from Zod) but never calls `registerSchema.parse()`.

---

## 🔴 SEV-03: Redis Connection Never Closed on Shutdown
**Files:** `src/queue/setup.ts:23` (connection creation), `src/server.ts:120-136` (shutdown handlers)
**Severity:** **CRITICAL** | **Impact:** Redis connection leak on every restart | **Fix effort:** 15 min

The `connection` object created at module level (`src/queue/setup.ts:23`) via `createRedisConnection()` is never closed. `closeQueue()` only closes the Queue and QueueEvents, not the underlying Redis connection. On SIGTERM/SIGINT, the connection remains open.

---

## 🔴 SEV-04: BullMQ Worker Never Gracefully Shut Down
**Files:** `src/queue/worker.ts:17` (startWorker), `src/server.ts:120-136` (shutdown handlers)
**Severity:** **CRITICAL** | **Impact:** In-flight jobs abruptly killed, possible data corruption | **Fix effort:** 30 min

`startWorker()` creates a Worker via `createWorker()` but the return value (the Worker instance) is never stored or closed. On server shutdown, actively processing jobs are force-killed. Worker `lockDuration` is 30s but shutdown provides no grace period.

---

## 🔴 SEV-05: JWT Payload Contains Plaintext Email in Token
**Files:** `src/lib/jwt.ts:6-8`, `src/types/auth.ts:1-4`, `src/modules/auth/auth.handler.ts:26,47`
**Severity:** **HIGH** | **Impact:** User email exposed in every JWT (can be decoded without key) | **Fix effort:** 5 min

JWT payload includes `{ userId, email }` in plaintext. While JWTs are signed, they are **not encrypted** — anyone who can read the token (network logs, browser storage) can extract the user's email. Email should only be in the token if required server-side; server can look up user by ID.

---

## 🔴 SEV-06: No Pagination on Any List Endpoint
**Files:** `src/modules/startups/startup.handler.ts:32-38`
**Severity:** **HIGH** | **Impact:** API unusable at 100+ startups per user | **Fix effort:** 1 hour

`listStartupsHandler` calls `prisma.startup.findMany()` with no `take` or `skip`. With 1000 users averaging 5 startups each, this returns all records in a single response with no cursor or offset pagination. No `totalCount` field is returned.

---

## 🔴 SEV-07: Prisma Connection Pool Not Configured
**Files:** `src/db/client.ts:5-7`
**Severity:** **HIGH** | **Impact:** Connection pool exhaustion under load, DB connection leaks | **Fix effort:** 15 min

PrismaClient is instantiated with no connection pool configuration:
```ts
new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["query", "warn", "error"] : ["warn", "error"],
});
```
Default Prisma connection limit is the number of connections in the pool (Postgres default: ~100, but Prisma defaults to `num_cpus * 2 + 1`). No `connection_limit` in `DATABASE_URL`. No `pool_timeout`. With BullMQ worker concurrency of 5 + request concurrency, pool exhaustion is likely.

---

## 🟠 SEV-08: Rate Limiter Bypass via Route-Scoped Hooks
**Files:** `src/server.ts:31-34`, `src/modules/startups/startup.routes.ts:11`, `src/modules/blueprints/blueprint.routes.ts:6`, `src/modules/websites/website.routes.ts:6`, `src/modules/deployments/deployment.routes.ts:6`, `src/modules/jobs/jobs.routes.ts:6`
**Severity:** **HIGH** | **Impact:** Rate limiting partially ineffective | **Fix effort:** 1 hour

Rate limiter is registered globally at `src/server.ts:31-34` (100 req/min). However, each protected route module registers a `preHandler` hook with `authenticate`, which runs **before** the rate limiter check. An attacker sending valid JWTs at high volume could bypass the intended rate limit because Fastify runs `preHandler` hooks registered at the route level **before** some global hooks depending on registration order.

The 429 handler at `src/server.ts:70-80` is actually an error handler that catches `statusCode === 429` — this is Fastify's pattern for customizing rate limit responses. It works correctly.

---

## 🟠 SEV-09: CORS Allows Any Origin with Credentials
**Files:** `src/server.ts:27-29`
**Severity:** **HIGH** | **Impact:** Cross-origin credential theft if XSS exists | **Fix effort:** 10 min

```ts
await app.register(cors, {
  origin: true,
  credentials: true,
});
```
`origin: true` reflects the request origin, and `credentials: true` allows cookies/auth headers. Any website can make authenticated requests if a user has a session cookie (currently JWTs are sent via `Authorization` header, but CORS is still overly permissive).

---

## 🟠 SEV-10: No Request Body Size Limitation
**Files:** `src/server.ts:21-23`
**Severity:** **HIGH** | **Impact:** Memory exhaustion via large payloads | **Fix effort:** 5 min

Fastify is instantiated with no `bodyLimit`. Default is 1MB but should be explicit. AI prompt endpoints accept up to 5000 chars but no hard size limit is enforced at HTTP level.

---

## 🟠 SEV-11: AI Provider Timeout `WEBSITE_AI_TIMEOUT_MS` Never Used
**Files:** `src/lib/env.ts:31` (defined), `src/services/ai/provider.ts:21` (used)
**Severity:** **MEDIUM** | **Impact:** Website generation cannot have longer timeout than blueprint | **Fix effort:** 5 min

`env.ts` defines `WEBSITE_AI_TIMEOUT_MS` (default 90000ms) but `provider.ts` always uses `AI_TIMEOUT_MS` (default 60000ms). Website HTML generation (which produces 2000+ line HTML) needs the longer timeout.

---

## 🟠 SEV-12: No Security Headers (No Helmet Equivalent)
**Files:** `src/server.ts`
**Severity:** **MEDIUM** | **Impact:** Susceptible to common web vulnerabilities | **Fix effort:** 15 min

No `@fastify/helmet` or equivalent is registered. No:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection`
- `Strict-Transport-Security`
- `Content-Security-Policy`

---

## 🟠 SEV-13: `providersUsed` Set Is Never Populated
**Files:** `src/services/renderer/index.ts:31,72`
**Severity:** **MEDIUM** | **Impact:** Stats always show empty provider list | **Fix effort:** 5 min

Line 31: `const providersUsed = new Set<string>();` is created but nothing ever calls `providersUsed.add(...)`. The stats returned always have `providersUsed: []`.

---

## 🟠 SEV-14: Health Endpoint Does Not Check Dependencies
**Files:** `src/server.ts:96-98`
**Severity:** **MEDIUM** | **Impact:** Health check passes when DB/Redis are down | **Fix effort:** 30 min

The `/health` endpoint returns `{ status: "ok" }` without checking:
- Database connectivity (Prisma `$queryRaw` ping)
- Redis connectivity
- BullMQ queue health

---

## 🟠 SEV-15: Job Monitor Has No Singleton Protection
**Files:** `src/server.ts:108`, `src/queue/monitor.ts:7-38`
**Severity:** **MEDIUM** | **Impact:** Duplicate timeout processing with multiple instances | **Fix effort:** 15 min

`startJobMonitor()` is called on every server instance. If running multiple replicas (horizontal scaling), all instances will run the same timeout check, causing redundant database writes and potential race conditions on job status updates.

---

## 🟠 SEV-16: Password Hashing Cost Is Too High
**Files:** `src/modules/auth/auth.handler.ts:19`
**Severity:** **MEDIUM** | **Impact:** Slow auth response times at scale | **Fix effort:** 5 min

```ts
const hashedPassword = await hash(password, 12);
```
bcrypt with 12 salt rounds takes ~250-350ms on modern hardware. For 1000 concurrent users logging in, this creates significant CPU load. Reduce to 10 rounds (still secure, ~80ms).

---

## 🟠 SEV-17: `maxRetriesPerRequest: null` Disables BullMQ Auto-Reconnect
**Files:** `src/queue/setup.ts:12,19`
**Severity:** **MEDIUM** | **Impact:** Queue permanently fails after transient Redis disconnect | **Fix effort:** 10 min

Setting `maxRetriesPerRequest: null` is required for BullMQ but disables ioredis's built-in retry mechanism. Redis cluster failovers or transient connection drops will cause permanent BullMQ failures instead of automatic reconnection.

---

## 🟠 SEV-18: Test File Imports TypeScript with `.js` Extension
**Files:** All test files in `tests/`
**Severity:** **MEDIUM** | **Impact:** Fragile imports, depends on specific Node module resolution | **Fix effort:** 30 min

Every test file imports source files with `.js` extension (e.g., `from "../src/services/ai/provider.js"`) even though the actual files are `.ts`. This works with ESM + Node 22 resolution but creates a fragile setup.

---

## 🟠 SEV-19: `query-db.js` Uses `.ts` Extension in Import
**File:** `query-db.js:4`
**Severity:** **MEDIUM** | **Impact:** Script is broken and cannot run | **Fix effort:** 5 min

```js
import { prisma } from './src/db/client.ts';
```
This imports a `.ts` file from a `.js` file with no TypeScript loader configured. Will throw `ERR_UNKNOWN_FILE_EXTENSION` at runtime.

---

## 🟠 SEV-20: No Refresh Token Mechanism
**Files:** `src/modules/auth/auth.handler.ts`, `src/lib/jwt.ts`
**Severity:** **MEDIUM** | **Impact:** Users must re-login after 7 days with no grace | **Fix effort:** 2 hours

JWT expires in 7 days with no refresh mechanism. When the token expires, the user's active session is lost. No token blacklist exists for logout.

---

## 🟠 SEV-21: No Logout or Token Revocation
**Files:** `src/modules/auth/auth.routes.ts`
**Severity:** **MEDIUM** | **Impact:** JWTs are valid until expiry, cannot invalidate sessions | **Fix effort:** 1 hour

No `/auth/logout` endpoint. No token blacklist (Redis or DB). Stolen tokens remain valid for up to 7 days.

---

## 🟠 SEV-22: Zod Schemas Only Validate AI Responses — Not Inputs
**Files:** `src/modules/auth/auth.schema.ts`, `src/modules/startups/startup.schema.ts`, `src/modules/blueprints/blueprint.schema.ts`, `src/modules/websites/website.schema.ts`
**Severity:** **MEDIUM** | **Impact:** Inconsistent validation approach across codebase | **Fix effort:** 2 hours

Zod schemas exist for every module's inputs but are only used for TypeScript type inference (`z.infer`). No handler calls `schema.parse()`. Fastify's JSON schema validation is used instead, which is less powerful and doesn't integrate with Zod's error handling.

---

## 🟠 SEV-23: Docker: Prisma Generate Runs Before Schema Is Copied
**Files:** `Dockerfile:11`
**Severity:** **MEDIUM** | **Impact:** Docker build may fail in some configurations | **Fix effort:** 5 min

```dockerfile
COPY package.json ./
RUN npm install
COPY . .
RUN npx prisma generate
```
While this works because `prisma/` is part of `.`, it's fragile. The `COPY . .` includes everything, including `node_modules/` (though `.dockerignore` excludes it).

---

## 🟠 SEV-24: Docker Does Not Run Database Migrations
**Files:** `Dockerfile`, `docker-compose.yml`
**Severity:** **MEDIUM** | **Impact:** Database schema not applied on deployment | **Fix effort:** 30 min

No `prisma migrate deploy` or `prisma db push` step in the Dockerfile or entrypoint script. The application connects to the database but will fail if the schema hasn't been applied.

---

## 🟠 SEV-25: Startup Routes Share `preHandler` Hook Scope
**Files:** `src/modules/startups/startup.routes.ts:11-12`
**Severity:** **LOW** | **Impact:** Cannot add public startup routes in the future | **Fix effort:** 5 min

```ts
app.addHook("preHandler", authenticate);
```
This applies authentication to **all** routes in the module. If any route needs to be public (e.g., a public startup profile page), this pattern prevents it. `authenticate` should be applied per-route instead.

---

## 🟠 SEV-26: No Email Verification
**Files:** `src/modules/auth/auth.handler.ts`
**Severity:** **LOW** | **Impact:** Anyone can register with any email without proving ownership | **Fix effort:** 4 hours

Users can register and immediately receive JWTs without email verification. The `/auth/me` endpoint does not check whether the email has been verified.

---

## 🟢 SEV-27: Empty Directories
**Files:** `src/routes/`, `src/services/website-generator/`, `src/services/deployment/`
**Severity:** **LOW** | **Impact:** Confusing project structure | **Fix effort:** 5 min

Three directories are completely empty. Either remove them or add the planned code.

---

## 🟢 SEV-28: Mock Deployment URL Uses Predictable Pattern
**Files:** `src/queue/worker.ts:312`
**Severity:** **LOW** | **Impact:** Predictable URLs if mock deployments are used | **Fix effort:** 5 min

```ts
const mockUrl = `https://${websiteId}.startupos.app`;
```
Uses the database UUID as a subdomain. If mock deployments are enabled in production, URLs are guessable.

---

## 🟢 SEV-29: Fastify Logger Set to `true` Instead of Custom Logger
**Files:** `src/server.ts:22`
**Severity:** **LOW** | **Impact:** Log format differs from custom pino logger | **Fix effort:** 5 min

```ts
const app = Fastify({ logger: true });
```
Uses Fastify's default logger instead of the custom `logger` from `src/lib/logger.ts`. The custom logger has pino-pretty in dev mode while Fastify's built-in logger does not.

---

## 🟢 SEV-30: No API Versioning
**Files:** All route files
**Severity:** **LOW** | **Impact:** Breaking changes cannot be versioned | **Fix effort:** 1 hour

All routes are registered at root level (`/auth`, `/startups`, etc.) with no `/api/v1/` prefix. Future API changes will require either breaking existing clients or maintaining parallel route registrations.

---

## 🟢 SEV-31: Graceful Shutdown Does Not Await Worker Closing
**Files:** `src/server.ts:120-136`
**Severity:** **LOW** | **Impact:** Running jobs may be lost on restart | **Fix effort:** 15 min

Shutdown handlers call `closeQueue()` and `app.close()` but **not** `worker.close()`. The Worker object is never stored from `startWorker()`, making it impossible to close gracefully.

---

## 🟢 SEV-32: Fallback Templates Ignore Most Section Content
**Files:** `src/services/renderer/fallbacks/home.ts:106-166`
**Severity:** **LOW** | **Impact:** Non-home fallback pages are generic regardless of spec | **Fix effort:** 2 hours

`renderGenericFallback` produces a generic page template that ignores section content, only using the page name and blueprint description. Pages like "Pricing", "FAQ", "Testimonials" all produce identical layouts.

---

## 🟢 SEV-33: Job Monitor Only Checks PROCESSING, Not PENDING
**Files:** `src/queue/monitor.ts:22-23`
**Severity:** **LOW** | **Impact:** Jobs stuck in PENDING never time out | **Fix effort:** 5 min

```ts
where: { status: "PROCESSING", updatedAt: { lt: cutoff } }
```
Jobs stuck in `PENDING` status are never caught by the timeout monitor. If a job is enqueued but never picked up by a worker, it stays PENDING forever.

---

## 🟢 SEV-34: `tsconfig.json` Has `allowImportingTsExtensions: false`
**Files:** `tsconfig.json:20`
**Severity:** **LOW** | **Impact:** Cannot natively import `.ts` files in ESM | **Fix effort:** 5 min

With ESM (`"type": "module"`), Node requires explicit file extensions. Since `.ts` imports are disallowed, all imports use `.js`. This works with `tsx` but `tsc --noEmit` may be confused.

---

## 🟢 SEV-35: Supabase Variables Defined But Never Used
**Files:** `src/lib/env.ts:18-20`, `.env:14-16`
**Severity:** **LOW** | **Impact:** Dead configuration | **Fix effort:** 5 min

`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_STORAGE_BUCKET` are defined in env schema and `.env` but never imported or used anywhere in the application code.