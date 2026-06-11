# StartupOS Backend V2 — Architecture Audit

> **Scope:** Full-stack architecture review of all 34 source files, Prisma schema, queue system, AI pipeline, deployment pipeline, and production readiness.
>
> **Methodology:** Line-by-line code review against production-grade standards.
>
> **Severity:**
> - **Critical** — Will cause data loss, security breach, or complete service outage at scale.
> - **High** — Will cause degraded experience, partial outages, or significant cost at scale.
> - **Medium** — Should be addressed before 10K users.
> - **Low** — Best practice improvement, low blast radius.

---

## 1. Authentication

### 1.1 JWT Security

| Issue | File | Severity |
|-------|------|----------|
| No token refresh mechanism | `src/lib/jwt.ts:5-8` | **High** |
| JWT payload includes email | `src/types/auth.ts:1-4` | **Low** |
| No token revocation/blacklist | Entire auth module | **High** |

**Analysis:**
- `signToken` produces JWTs with a fixed expiry (default `7d`). After expiry the user must re-login. No refresh token flow exists.
- The JWT contains `userId` and `email`. Email is a PII concern if the token is logged or leaked. Only `userId` is needed for auth; email is redundant.
- There is no mechanism to revoke a compromised token. A leaked JWT is valid until expiry. No blocklist, no token version, no rotation.

### 1.2 Token Expiry

| Issue | File | Severity |
|-------|------|----------|
| Single long-lived session token | `src/modules/auth/auth.handler.ts:27,48` | **High** |
| No separate access/refresh token pair | All auth handlers | **High** |

**Analysis:**
- A single 7-day token is both the access token and the session token. If stolen, the attacker has 7 days of access with no way to revoke.
- Standard pattern: short-lived access token (15 min) + long-lived refresh token (7 days) + refresh endpoint.

### 1.3 Refresh Token Strategy

| Issue | File | Severity |
|-------|------|----------|
| No refresh token endpoint | `src/modules/auth/auth.routes.ts` | **Critical** |

**Analysis:**
- No `/auth/refresh` endpoint exists. Users cannot extend sessions without re-entering credentials.
- This forces either: (a) users re-login every 7 days, or (b) clients store the password and auto-login (security disaster).
- For a product where founders "return later" (stated requirement), this is a critical UX blocker.

### 1.4 Password Hashing

| Issue | File | Severity |
|-------|------|----------|
| bcrypt salt rounds = 12 | `src/modules/auth/auth.handler.ts:20` | **Medium** |
| No password complexity rules | `src/modules/auth/auth.schema.ts:5` | **Medium** |

**Analysis:**
- Salt rounds of 12 is ~250ms per hash on modern hardware. At 10K users with spike registration, this could cause a CPU bottleneck on a single-threaded Node event loop (bcrypt is synchronous in JS, but the Node.js `hash()` function is async and uses libuv threadpool).
- The threadpool (default 4 threads) will become a bottleneck at ~16 concurrent registrations. This can be mitigated by increasing `UV_THREADPOOL_SIZE`.
- No password complexity rules beyond min 8 chars. No requirement for uppercase, lowercase, digits, or special characters.

### 1.5 Brute Force Protection

| Issue | File | Severity |
|-------|------|----------|
| No login-specific rate limiting | `src/server.ts:30-33` | **Critical** |
| Single global rate limit (100 req/min) | `src/server.ts:30-33` | **High** |

**Analysis:**
- The global rate limiter at 100 req/min applies to all endpoints uniformly. An attacker can make 100 login attempts per minute before the global limit kicks in.
- No per-endpoint rate limiting. Login should have a strict limit (e.g., 5 attempts/min per IP, 10 attempts/min per email).
- No account lockout mechanism after N failed attempts.
- No exponential backoff for repeated failed logins.

### Summary: Authentication Gaps

```
Critical: 1 (no refresh token)
High:     4 (no revocation, long-lived single token, no brute force login limits)
Medium:   2 (bcrypt threadpool, password complexity)
Low:      1 (PII in JWT)
```

---

## 2. Database

### 2.1 Indexes

| Table | Existing Indexes | Missing Indexes | Severity |
|-------|-----------------|-----------------|----------|
| `User` | Unique on `email` (implicit) | None | — |
| `Startup` | `[userId]` | `[userId, createdAt]` for sorted listing | **Medium** |
| `Blueprint` | None beyond PK | `[startupId]` (has unique, gets index) | — |
| `Website` | None beyond PK | `[startupId]`, `[status]` | **Medium** |
| `WebsiteSpec` | None beyond PK | `[websiteId]` (has unique, gets index) | — |
| `Deployment` | None beyond PK | `[status]`, `[websiteId]` (has unique, gets index) | **Medium** |
| `Job` | `[startupId]`, `[status]` | `[type, status]` for worker queries, `[createdAt]` for cleanup | **Medium** |
| `ApiLog` | None | `[createdAt]`, `[userId]`, `[path]` | **Low** |

**Key Finding:** `listStartupsHandler` does `findMany({ where: { userId }, orderBy: { createdAt: "desc" } })`. Without a composite `[userId, createdAt]` index, Postgres will filter on `userId` (using the existing index) then sort in memory. At 1000 startups per user, this is a sort operation on the hot path.

### 2.2 Unique Constraints

| Table | Constraint | Assessment |
|-------|-----------|------------|
| `User.email` | `@unique` | Correct |
| `Blueprint.startupId` | `@unique` | Correct — one blueprint per startup |
| `WebsiteSpec.websiteId` | `@unique` | Correct — one spec per website |
| `Deployment.websiteId` | `@unique` | Correct — one deployment per website |

No issues found with unique constraints. They correctly enforce business rules.

### 2.3 Cascade Deletes

| Relation | Cascade | Assessment |
|----------|---------|------------|
| `User → Startup` | `Cascade` | Correct |
| `Startup → Blueprint` | `Cascade` | Correct |
| `Startup → Website` | `Cascade` | Correct |
| `Startup → Job` | `Cascade` | Correct |
| `Website → WebsiteSpec` | `Cascade` | Correct |
| `Website → Deployment` | `Cascade` | Correct |

**Issue:** No soft delete capability. When a startup is deleted, ALL data (blueprints, websites, deployments, jobs) is permanently lost. There is no way to recover a deleted startup, and no audit trail of the deletion.

| Issue | Severity |
|-------|----------|
| No soft delete on any table | **High** |
| No audit log for deletions | **Medium** |

### 2.4 Query Performance

| Issue | File | Severity |
|-------|------|----------|
| `listStartupsHandler` returns all startups with no pagination | `src/modules/startups/startup.handler.ts:32-37` | **High** |
| `getStartupHandler` loads all related data eagerly | `src/modules/startups/startup.handler.ts:50-62` | **Medium** |
| No query parameter filtering on list endpoints | All list handlers | **Medium** |

**Analysis:**
- `listStartupsHandler` does `findMany` with no `take` or `skip`. A user with 1000 startups returns 1000 records every time. At 10K users × 1000 startups each, this is a 10M-row scan in the worst case (though scoped to userId).
- `getStartupHandler` eagerly loads blueprint + all websites + all deployments + counts in one query. For a startup with 50 websites, this inflates the response size and query time.
- No list endpoint supports pagination (`page`, `limit`, `cursor`), filtering, or search.

### 2.5 Transaction Safety

| Issue | File | Severity |
|-------|------|----------|
| Job creation + queue add are not atomic | `src/modules/blueprints/blueprint.handler.ts:41-57` | **High** |
| Job creation + queue add are not atomic | `src/modules/websites/website.handler.ts:36-52` | **High** |
| Job creation + deployment creation + queue add not atomic | `src/modules/deployments/deployment.handler.ts:39-62` | **High** |
| Worker DB operations not in transactions | `src/queue/worker.ts:36-198` | **High** |

**Analysis:**
- In every handler, the pattern is: (1) create DB job, (2) add to BullMQ queue. If step 2 fails, there is an orphaned DB job in `PENDING` status that will never be processed. No cleanup mechanism exists.
- In workers, multiple sequential DB writes (update job to PROCESSING → create blueprint → update job to COMPLETED) are not wrapped in Prisma transactions. If the process crashes between steps, the job is stuck in `PROCESSING` state.
- The worker's `handleDeployment` writes `BUILDING` status before the try block, then `LIVE` inside. If the process crashes after `BUILDING` but before `LIVE`, the deployment is permanently stuck in `BUILDING`.

### 2.6 Other Database Issues

| Issue | File | Severity |
|-------|------|----------|
| `Website.status` is `String` (free text) instead of enum | `prisma/schema.prisma:85` | **Medium** |
| `ApiLog` table created but never written to | `prisma/schema.prisma:125-134` + whole codebase | **Medium** |
| `Job.payload` and `Job.result` are `Json?` with no schema enforcement | `prisma/schema.prisma:112-113` | **Medium** |
| No `updatedAt` on `ApiLog` (minor) | `prisma/schema.prisma:125-133` | **Low** |

### Summary: Database Gaps

```
Critical: 0
High:     6 (no pagination, 3x no atomicity, 2x transaction gaps in workers)
Medium:   7 (missing composite indexes, eager loading, Website.status string, ApiLog dead table, soft deletes, Job JSON schema, DB migration strategy)
Low:      1 (ApiLog missing updatedAt)
```

---

## 3. Queue System

### 3.1 Worker Crashes

| Issue | File | Severity |
|-------|------|----------|
| No worker graceful shutdown | `src/queue/worker.ts:10-34` | **Critical** |
| Worker uses `console.log`/`console.error` instead of logger | `src/queue/setup.ts:47-53` | **Low** |
| No health check for worker process | `src/queue/worker.ts` | **Medium** |

**Analysis:**
- When `server.ts` handles SIGTERM, it closes the queue but does NOT call `worker.close()`. The worker can be mid-job when Redis connections are terminated. BullMQ's `worker.close()` should be awaited to let in-progress jobs finish (or reach the lock timeout).
- If a worker crashes (process.exit, uncaught exception), BullMQ will re-process jobs after `lockDuration` (30s). This is good, but:
  - The job in Prisma was already updated to `PROCESSING`. The retry will attempt to update it to `PROCESSING` again (no-op), then re-execute. This is safe.
  - However, if the crash happened AFTER the Prisma `create` (e.g., blueprint created) but BEFORE the `job.update` to COMPLETED, the retry will create a DUPLICATE blueprint. See section 3.2.

### 3.2 Duplicate Jobs

| Issue | File | Severity |
|-------|------|----------|
| No idempotency key on job creation | `src/modules/blueprints/blueprint.handler.ts:41-57` | **Critical** |
| Race condition on duplicate click | `src/modules/websites/website.handler.ts:36-52` | **High** |
| Worker can produce duplicate side effects on retry | `src/queue/worker.ts:48-65` | **Critical** |

**Analysis:**
- **Client-side double-click:** If a user clicks "Generate Blueprint" twice before the first response arrives, two `Job` records and two BullMQ jobs are created. No idempotency key (e.g., `userId+startupId+type` hash) prevents this.
- **Worker retry produces duplicates:** In `handleBlueprintGeneration`, the sequence is:
  1. Update job to PROCESSING
  2. Call AI API
  3. **Create blueprint** ← This is NOT idempotent
  4. Update job to COMPLETED
  - If the process crashes between step 3 and 4, the retry will call the AI API again and create ANOTHER blueprint. The startup now has two blueprints, violating the `@unique` constraint on `startupId`, causing the retry to crash with a unique constraint violation. The job enters a permanent retry → fail loop.
- Same pattern exists in `handleWebsiteGeneration` and `handleDeployment`.

### 3.3 Retry Loops

| Issue | File | Severity |
|-------|------|----------|
| No dead letter queue | `src/queue/setup.ts:17-25` | **High** |
| AI provider failure retries all 3 times before failing | `src/queue/setup.ts:18` | **Medium** |
| No retry limit escalation | All workers | **Medium** |

**Analysis:**
- When all 3 retries are exhausted, the job is marked as FAILED in BullMQ and `removeOnFail: 50` means it's kept for 50 jobs then evicted. There's no DLQ to inspect failed jobs.
- If an AI provider is down for 10 minutes, every blueprint and website job will retry 3 times each before failing. This multiplies API call volume by 3 during an outage.
- No exponential backoff max cap — the backoff starts at 2s and doubles (2s, 4s, 8s), but without a max, a long chain of retries could reach unreasonable delays.

### 3.4 Stuck Jobs

| Issue | File | Severity |
|-------|------|----------|
| No stuck job monitor | Entire queue system | **High** |
| `PROCESSING` status is terminal if worker never finishes | `src/queue/worker.ts` | **Critical** |
| No job timeout | Worker has no timeout enforcement | **High** |

**Analysis:**
- If a worker process is killed (OOM, `SIGKILL`), the BullMQ job will be picked up by another worker after `lockDuration` (30s). However, the Prisma `Job.status` was already set to `PROCESSING`. The new attempt will set it to `PROCESSING` again — safe but worth noting.
- If the AI API call hangs indefinitely (no timeout on `fetch`), the worker is permanently blocked. No other job of that type can be processed (concurrency = 5, but if all 5 slots are hung, the queue is dead).
- There is no cron job or heartbeat that detects jobs in `PROCESSING` status for longer than a reasonable threshold (e.g., 5 minutes) and resets them to `PENDING`.

### 3.5 Job Cleanup

| Issue | File | Severity |
|-------|------|----------|
| `removeOnComplete: 100` — audit trail lost | `src/queue/setup.ts:23` | **Low** |
| `removeOnFail: 50` — failed job history lost | `src/queue/setup.ts:24` | **Low** |
| No archival or summary retention | `src/queue/setup.ts` | **Low** |

**Analysis:**
- The Prisma `Job` table serves as the permanent record, so BullMQ's aggressive cleanup is acceptable. The `Job` table retains all records indefinitely.
- However, no archival strategy exists for the `Job` table. At 10K users creating an average of 3 jobs/day, that's 30K rows/day, 10.9M rows/year.

### Summary: Queue Gaps

```
Critical: 3 (worker crash duplicate side effects, duplicate job creation, stuck PROCESSING jobs)
High:     5 (no worker graceful shutdown, no DLQ, no stuck monitor, no job timeout, duplicate website jobs on double-click)
Medium:   4 (retry amplifies AI outages, no retry cap, no health checks, PROCESSING status safety)
Low:      3 (console.log, BullMQ cleanup settings, console.error)
```

---

## 4. AI Generation

### 4.1 Timeout Handling

| Issue | File | Severity |
|-------|------|----------|
| No fetch timeout on AI API calls | `src/services/ai/provider.ts:17-29` | **Critical** |
| Worker has no timeout for AI sub-task | `src/queue/worker.ts:49-50` | **High** |

**Analysis:**
- `callAPI` uses `fetch()` with no AbortSignal. If the AI provider's DNS fails, TCP handshake hangs, or the request is rate-limited without response, the worker thread is blocked indefinitely.
- At concurrency=5 and all 5 workers blocked on hanging AI calls, the entire queue is dead until the workers are restarted.
- **Fix:** Add `AbortController` with a timeout (e.g., 60s for blueprint, 30s for website spec).

### 4.2 Provider Outages

| Issue | File | Severity |
|-------|------|----------|
| No automatic provider fallback | `src/services/ai/provider.ts:209-225` | **Critical** |
| Provider selection is static (first match wins) | `src/services/ai/provider.ts:210-220` | **High** |
| No health check endpoint for providers | `src/services/ai/provider.ts` | **Medium** |

**Analysis:**
- `getAIProvider()` is called at job execution time and returns the FIRST configured provider. If FreeLLM is configured but goes down, every job fails. There is no fallback to Groq or OpenRouter.
- The spec says "Priority: FreeLLMAPI → Groq → OpenRouter → fail" with "No deterministic fallback" — I interpret this as no *deterministic* fallback (e.g., don't hardcode), but the current implementation has ZERO fallback.
- When a provider error occurs (e.g., 429 rate limit), the error is thrown, the job retries 3 times (all hitting the SAME dead provider), then the job fails permanently. No provider rotation on failure.
- **Fix:** Wrap provider call with try/catch and fall through to next provider in the priority chain.

### 4.3 Malformed JSON

| Issue | File | Severity |
|-------|------|----------|
| `JSON.parse` on AI output without validation | `src/services/ai/provider.ts:41-42` | **Critical** |
| No schema validation of AI response | `src/services/ai/provider.ts:40-43` | **High** |
| No retry on parse failure | `src/services/ai/provider.ts:41` | **Medium** |

**Analysis:**
- `parseJSONResponse` does `JSON.parse(cleaned) as T`. If the AI returns:
  - Non-JSON text: throws `SyntaxError` → job fails
  - Valid JSON but wrong structure: silently casts to `T` with no runtime validation
  - Truncated JSON (max_tokens hit): throws `SyntaxError` → job fails
  - Empty string (choices[0]?.message?.content is undefined): crashes on `.replace`
- **No Zod validation** of AI responses against `BlueprintResult` or `WebsiteSpecResult` schemas.
- A single malformed response causes 3 retries (3 wasted AI calls) then permanent failure.
- **Fix:** Schema-validate AI responses. Retry on parse failure with different temperature.

### 4.4 Rate Limits

| Issue | File | Severity |
|-------|------|----------|
| No AI rate limit awareness | `src/services/ai/provider.ts:17-29` | **High** |
| No request queuing for AI API | All AI provider methods | **Medium** |
| Retry amplifies rate limit issues | `src/queue/setup.ts:18` + retry on `callAPI` | **High** |

**Analysis:**
- When an AI provider returns 429 (rate limit), `callAPI` throws. The job retries after exponential backoff. Three retries with ~10s total backoff may not be enough for rate limit windows (typically 1 minute).
- No tracking of API usage. At 10K users generating blueprints, costs could surprise.
- No per-user AI rate limiting. A single abusive user could exhaust the API quota for everyone.

### 4.5 Cost Protection

| Issue | File | Severity |
|-------|------|----------|
| No AI cost tracking | Entire system | **Medium** |
| No per-user AI usage limits | All blueprints/websites handlers | **Medium** |
| No max token limits per request (hardcoded 4096) | `src/services/ai/provider.ts:27` | **Low** |

**Analysis:**
- `max_tokens: 4096` is hardcoded. Blueprint generation may need more tokens for complex startups.
- No billing/usage tracking. At $0.01 per blueprint via Groq and 10K users generating once, that's $100 — manageable. But a single user generating 10K blueprints via script would cost $100+.
- **Fix:** Add per-user generation limits and cost tracking.

### Summary: AI Generation Gaps

```
Critical: 3 (no fetch timeout, no provider fallback, no JSON validation)
High:     5 (worker timeout, static provider selection, no schema validation, rate limit amplification, 429 handling)
Medium:   5 (no provider health checks, no retry on parse failure, no AI rate limiting, no cost tracking, no per-user limits)
Low:      1 (hardcoded max_tokens)
```

---

## 5. Deployment System

### 5.1 Deployment Race Conditions

| Issue | File | Severity |
|-------|------|----------|
| Two concurrent deployment requests for same website | `src/modules/deployments/deployment.handler.ts:30-43` | **Critical** |
| No database-level pessimistic lock | `src/modules/deployments/deployment.handler.ts:30` | **High** |

**Analysis:**
- The pattern is: (1) read website with deployment, (2) check if deployment exists, (3) create deployment, (4) create job. This is a classic TOCTOU race condition.
- If two requests arrive simultaneously:
  - Request A reads `website.deployment` = null
  - Request B reads `website.deployment` = null
  - Request A creates deployment D1
  - Request B creates deployment D2 (which violates the `@unique` constraint on `websiteId`, potentially crashing)
  - Request A creates job J1 → queued
  - Request B creates job J2 → queued
- The `Deployment.websiteId` unique constraint will prevent duplicate deployments at the DB level, but the second request will crash with a Prisma error, and the orphan job J2 will remain in PENDING.
- **Fix:** Use `SELECT ... FOR UPDATE` or Prisma's `create` with a check that fails atomically.

### 5.2 Invalid Deployment States

| Issue | File | Severity |
|-------|------|----------|
| No state machine validation | `src/queue/worker.ts:160-168` | **High** |
| Can transition from any state to any other state | `src/queue/worker.ts:160-168` | **Medium** |

**Analysis:**
- The state machine for `DeploymentStatus` is: `PENDING → BUILDING → DEPLOYING → LIVE | FAILED`.
- The worker's `handleDeployment` does `BUILDING` then `LIVE` with no validation of current state.
- If a job retries (e.g., crash after `BUILDING`), the retry writes `BUILDING` again (fine), but if the previous job had set `LIVE` before crashing, the retry would erroneously write `BUILDING` over `LIVE`, regressing the deployment.
- **Fix:** Use Prisma `updateMany` with a `where` clause that checks current state, e.g., `where: { id, status: "BUILDING" }` when transitioning to `LIVE`. If no rows matched, the state transition is invalid.

### 5.3 Failed Deployment Recovery

| Issue | File | Severity |
|-------|------|----------|
| No recovery mechanism for FAILED deployments | `src/queue/worker.ts:180-196` | **High** |
| No manual redeploy trigger | `src/modules/deployments/deployment.handler.ts:30-36` | **Medium** |
| No deployment rollback | `src/queue/worker.ts:166-168` | **Medium** |

**Analysis:**
- When a deployment fails, it's marked `FAILED`. There's no way to retry it. The `createDeploymentHandler` returns "Website already deployed" if any deployment exists (including FAILED).
- A failed deployment permanently blocks the website from being deployed. The only fix is a DB manual update or deleting the deployment record directly.
- **Fix:** Allow redeploy when deployment status is `FAILED`. Add a `redeploy` endpoint.

### 5.4 Deployment URL

| Issue | File | Severity |
|-------|------|----------|
| URL is hardcoded `https://${websiteId}.startupos.app` | `src/queue/worker.ts:168` | **Medium** |
| URL is set synchronously in worker | `src/queue/worker.ts:166-168` | **Medium** |

**Analysis:**
- The deployment URL is a simple string interpolation with the website ID. There is no actual deployment to a hosting platform.
- The deployment is marked `LIVE` immediately after writing the URL, with no actual build or deploy step. This means the "deployment" is instantaneous and always succeeds (barring DB errors).

### Summary: Deployment Gaps

```
Critical: 1 (TOCTOU race condition on deployment creation)
High:     4 (no state machine validation, no recovery from FAILED, retry regression of LIVE status, no actual deployment logic)
Medium:   4 (no DB pessimistic lock, no redeploy trigger, no rollback, hardcoded URL)
Low:      0
```

---

## 6. API Design

### 6.1 Idempotency

| Issue | File | Severity |
|-------|------|----------|
| No `Idempotency-Key` header support | All POST endpoints | **High** |
| POST /blueprints/generate not idempotent | `src/modules/blueprints/blueprint.handler.ts:41-57` | **High** |
| POST /websites/generate not idempotent | `src/modules/websites/website.handler.ts:36-52` | **High** |
| POST /deployments/create not idempotent | `src/modules/deployments/deployment.handler.ts:39-62` | **High** |

**Analysis:**
- None of the POST endpoints support idempotency. If a client retries a request due to network error, duplicate resources are created.
- For `/blueprints/generate` — the existing blueprint check prevents duplicate blueprints, but creates duplicate jobs. The job then fails with unique constraint violation on `startupId`.
- For `/websites/generate` — no guard at all. Each request creates a new website generation job.
- For `/deployments/create` — the existing deployment check has a TOCTOU race condition (see 5.1).

### 6.2 Validation Gaps

| Issue | File | Severity |
|-------|------|----------|
| No Zod validation in route handlers (only in schemas) | All handlers | **Medium** |
| No validation of `DELETE /startups/:id` param as UUID | `src/modules/startups/startup.handler.ts:77` | **Low** |
| No validation on `POST /deployments/create` body schema | `src/modules/deployments/deployment.handler.ts:8` | **Medium** |
| No response validation | All handlers | **Low** |

**Analysis:**
- Zod schemas are defined (`registerSchema`, `createStartupSchema`, etc.) but are never used to validate request bodies in the handlers. The handlers use the TypeScript types (`RegisterInput`) but this provides zero runtime safety. Fastify's schema validation (JSON Schema) provides runtime validation, but the Zod schemas are independent and unused.
- The deployment handler's body type is declared inline as `{ websiteId: string }` with no Zod schema at all.
- No Zod schemas are used to validate AI provider responses.

### 6.3 Missing Ownership Checks

| Issue | File | Severity |
|-------|------|----------|
| All endpoints check ownership | All handlers | — |

All endpoints checked appear to have proper ownership verification via `userId` comparison. No gaps found.

### 6.4 Rate Limiting Gaps

| Issue | File | Severity |
|-------|------|----------|
| Global rate limit only (100 req/min) | `src/server.ts:30-33` | **High** |
| No per-route rate limits | `src/server.ts:30-33` | **High** |
| No per-user rate limits | `src/server.ts:30-33` | **Medium** |
| No burst allowance | `src/server.ts:30-33` | **Low** |

**Analysis:**
- A single global limit of 100 req/min means all endpoints share the same bucket. A burst of health checks (legitimate) can exhaust the limit and cause auth requests to be rejected.
- Auth endpoints should have strict limits (5 req/min for login per IP). AI generation endpoints should have user-level limits. Health check should have a high limit or no limit.
- At 10K users averaging 20 requests each per minute, 200K req/min would all be blocked by the 100 req/min global limit. This means the limit is only functional at very small scale.
- **Fix:** Remove or raise the global limit significantly. Apply per-route and per-user limits instead.

### 6.5 Other API Issues

| Issue | File | Severity |
|-------|------|----------|
| No request ID tracking | `src/server.ts` | **Medium** |
| No CORS origin restriction (`origin: true`) | `src/server.ts:26` | **Medium** |
| Error responses include stack traces in dev mode? | `src/lib/errors.ts:52-56` | **Low** |
| No `PATCH /startups/:id` for updates | Not implemented | **Medium** |
| No `PATCH /websites/:id` for updates | Not implemented | **Low** |
| No `GET /startups/:id/websites` nested resource route | Not implemented | **Low** |
| No API version prefix (`/v1/...`) | All routes | **Low** |

### Summary: API Design Gaps

```
Critical: 0
High:     5 (no idempotency on 4 POST endpoints, global rate limit too permissive)
Medium:   7 (Zod validation unused, deployment body unschematized, no request IDs, CORS open, no per-route limits, no per-user limits, no PATCH endpoints)
Low:      5 (no UUID validation, no response validation, burst allowance, no version prefix, missing nested routes)
```

---

## 7. Production Readiness — Scale Simulation

### 7.1 100 Users

| Bottleneck | Impact | Fix |
|------------|--------|-----|
| No pagination on `GET /startups` | Negligible (1-5 startups/user) | Add pagination now before it compounds |
| No AI timeout | If one provider call hangs, one worker slot is blocked. With concurrency=5, 20% capacity lost. | Add AbortController with 60s timeout |
| bcrypt salt rounds=12 | At 100 users, registration spikes are rare. Threadpool handles fine. | Monitor, no action needed until 1000+ |
| **Assessment:** Acceptable for 100 users with minor risk. | | |

### 7.2 1000 Users

| Bottleneck | Impact | Fix |
|------------|--------|-----|
| No pagination | If users average 10 startups, 10K records returned per listing. Response size ~500KB. | Add `take`/`skip`/`cursor` pagination |
| Worker concurrency=5 | 1000 users generating websites at 1/day = 1000 jobs/day. 5 concurrent workers handle ~7200 jobs/day (assuming 60s/job). Fine. | Increase to 10 in production |
| Missing composite index `[userId, createdAt]` | `listStartups` sorts 10K rows in memory per hot request. | Add composite index |
| No refresh tokens | Every 7 days, 1000 users re-login. Minor UX friction. | Add refresh token endpoint |
| No provider fallback | If primary AI provider has 10min outage: 1000 generation jobs fail. 1000 users see errors. | Implement provider chain fallback |
| **Assessment:** 1000 users reveals missing pagination as the primary bottleneck. AI provider single-point-of-failure becomes visible. | | |

### 7.3 10,000 Users

| Bottleneck | Impact | Fix |
|------------|--------|-----|
| **ALL Critical issues** combine | 3+ duplicate side effects × no timeout × no fallback = cascading failures | Address all Critical issues |
| Global rate limit (100 req/min) | 10K users × 10 req/min = 100K req/min. 99.9% of requests blocked. | Per-route + per-user rate limits. Raise global to 10K+ |
| No job timeout | AI provider latency spike: 50 concurrent requests (10s each). With 5 workers, queue backs up 1000+ deep. | Job TTL + fetch timeout |
| No pagination | 10K users × avg 5 startups = 50K records per listing query. Response > 5MB, query > 500ms. | Mandatory pagination |
| No transaction safety | On 10K concurrent requests/week, the TOCTOU deployment race WILL trigger. | Atomic operations + Prisma transactions |
| Threadpool exhaustion (bcrypt) | Default libuv threadpool = 4 threads. At 100 concurrent logins, bcrypt hashes queue up, delaying ALL async operations. | Increase `UV_THREADPOOL_SIZE` to CPU count × 2 |
| **Dead letter queue missing** | At 10K jobs/day, 3% failure rate = 300 failed jobs/day with no inspection mechanism. | Implement DLQ + alerting |
| Stuck jobs accumulate | 1% of jobs get stuck = 100 stuck jobs/day. After 30 days = 3000 stuck records. | Stuck job monitor + auto-retry |
| No AI cost tracking | 10K users × 2 generations/month = 20K API calls. Unknown cost. | Cost tracking + per-user limits |
| Connection pool exhaustion | Prisma default pool = 10 connections. 10K concurrent requests = contention. | Increase pool to 20-50, add PgBouncer |
| No graceful worker shutdown | Rolling deployment kills in-flight jobs. | Implement `worker.close()` with graceful timeout |
| **Assessment:** 10K users is a breaking point for every subsystem. The system will experience cascading failures within hours. | | |

### Scaling Priority Matrix

| Priority | Fix | Prevents |
|----------|-----|----------|
| **P0** | Add fetch timeout to all AI calls | Worker starvation, queue death |
| **P0** | Add provider fallback chain | Total AI outage = total app outage |
| **P0** | Add Zod validation of AI JSON responses | Silent data corruption, crashes |
| **P0** | Make job creation + queue add atomic | Orphaned PENDING jobs |
| **P0** | Add worker graceful shutdown + `worker.close()` | In-flight job loss on deploy |
| **P0** | Add stuck job monitor + timeout | Permanent PROCESSING state |
| **P1** | Add idempotency keys to POST endpoints | Duplicate jobs, wasted AI spend |
| **P1** | Fix TOCTOU race on deployment creation | Constraint violation crashes |
| **P1** | Add refresh token endpoint | 7-day forced re-login |
| **P1** | Add rate limiting per-route and per-user | Global rate limits block all traffic |
| **P1** | Add pagination to all list endpoints | Response bloat, slow queries |
| **P1** | Add Prisma transactions in workers | Partial state updates on crash |
| **P2** | Add composite index `[userId, createdAt]` on Startup | Sorting in memory at scale |
| **P2** | Implement state machine validation for deployments | Invalid state transitions |
| **P2** | Allow redeploy on FAILED deployments | Permanent deployment blockage |
| **P2** | Add soft deletes | Data recovery |
| **P2** | Increase `UV_THREADPOOL_SIZE` | bcrypt blocking event loop |
| **P3** | Add AI cost tracking | Budget overruns |
| **P3** | Add request IDs | Debugging difficulty |
| **P3** | Add Prisma connection pooling + PgBouncer | Connection exhaustion at 10K |
| **P3** | Add password complexity rules | Weak passwords |
| **P3** | Implement BullMQ dead letter queue | Lost audit trail on failed jobs |

### Failure Scenario: Cascading Outage

```
1. AI provider has 5-minute latency spike
2. 5 worker slots all blocked on hanging AI calls (no timeout)
3. Queue backs up to 500+ pending jobs
4. New requests create more BullMQ jobs
5. Redis memory usage spikes (BullMQ stores job data)
6. Redis starts evicting keys → BullMQ loses job metadata
7. Orphaned Prisma jobs accumulate in PENDING
8. Users retry → create even more jobs
9. Redis OOM → queue connection drops
10. All BullMQ operations fail → API returns 500 for all generate/deploy endpoints
11. Users retry login → bcrypt threadpool exhaustion
12. Entire API becomes unresponsive
```

**All of the above is preventable** by addressing the P0 issues identified in this audit.

---

## 8. Audit Summary

### By Severity

| Severity | Count | Key Issues |
|----------|-------|------------|
| **Critical** | 7 | No AI timeout, no provider fallback, no JSON validation, duplicate side effects on retry, duplicate jobs from double-click, TOCTOU deployment race, stuck PROCESSING jobs |
| **High** | 29 | No refresh token, no token revocation, no brute force login limiting, no soft deletes, 3× non-atomic job+queue creation, no worker graceful shutdown, no DLQ, no stuck job monitor, no job timeout, static provider selection, no schema validation, rate limit amplification, no deployment state machine, no FAILED recovery, 5× no idempotency, global rate limit, missing composite indexes, no pagination, no per-route limits, Website.status as string, Transaction gaps |
| **Medium** | 22 | bcrypt threadpool at scale, no password complexity, eager loading, ApiLog unused, no per-user AI limits, no cost tracking, CORS open, no request IDs, no PATCH endpoints, Prisma pool size, no DB migration strategy, etc. |
| **Low** | 10 | PII in JWT, console.log vs logger, BullMQ cleanup settings, hardcoded max_tokens, no version prefix, etc. |

### By Category

| Category | Critical | High | Medium | Low |
|----------|----------|------|--------|-----|
| Authentication | 0 | 4 | 2 | 1 |
| Database | 0 | 6 | 7 | 1 |
| Queue System | 3 | 5 | 4 | 3 |
| AI Generation | 3 | 5 | 5 | 1 |
| Deployment | 1 | 4 | 4 | 0 |
| API Design | 0 | 5 | 7 | 5 |
| **Total** | **7** | **29** | **29** | **11** |

### Verdict

**The backend skeleton is structurally sound (clean separation, proper layering, correct Prisma relationships) but lacks production hardening in every subsystem.**

The architecture will function correctly for:
- **<10 users**: Testing, development, demo
- **<100 users**: Light beta with occasional failures
- **<1000 users**: Frequent failures, manual recovery needed
- **10000+ users**: Cascading outage within hours of launch

**Estimated engineering effort to address all P0 issues:** 3-5 days
**Estimated effort for all P1 issues:** 5-7 days
**Estimated effort for P2/P3:** Ongoing (2-3 weeks total)

---

*Audit performed: 2026-06-11*
*Auditor: Lead Backend Architect*
*Scope: All 34 source files + Prisma schema + configuration*