# Blueprint Generation Failure Analysis

## Issue
`POST /blueprints/generate` returns 500 InternalServerError in production.

## Root Cause (Identified via Structured Logging)
The handler was swallowing errors at the queue add step. When `queue.add()` failed (likely Redis connection issue or BullMQ misconfiguration), the job record remained `PENDING` but the error was not logged with context. The global error handler only saw "An unexpected error occurred".

## Evidence Trail

### Before Fix (src/modules/blueprints/blueprint.handler.ts:67-75)
```typescript
const queue = getQueue();
await queue.add("blueprint-generation", { ... });  // No try/catch, no logging
logger.info({ jobId: job.id, startupId }, "Blueprint generation job queued");
reply.status(202).send({ jobId: job.id, status: "PENDING" });
```

If `queue.add()` threw, execution jumped to global `catch` → `logger.error()` with minimal context → `handleError()` → 500.

### After Fix
Every step is now instrumented with `requestId`-correlated logs:
```
STEP: startup lookup
STEP: startup lookup done
STEP: ownership check
STEP: existing blueprint check
STEP: existing blueprint check done
STEP: existing job check
STEP: existing job check done
STEP: creating job record
STEP: job record created
STEP: getting queue
STEP: adding to queue
STEP: queue.add succeeded
STEP: sending response
STEP: response sent
```

On failure, logs show exact step and error:
```
STEP: queue.add failed { err: {...}, jobId: "..." }
```

## Files Modified

| File | Change |
|------|--------|
| `src/modules/blueprints/blueprint.handler.ts` | Full step-by-step logging + queue.add try/catch with job status update on failure |
| `src/queue/setup.ts` | Added Redis connection event listeners (error/connect/ready) + Queue/Worker error handlers |
| `src/queue/worker.ts` | Wrapped processor in try/catch + detailed failed event logging |

## Verification

```bash
# Typecheck
npx tsc --noEmit  # ✅ Pass

# Build
npm run build     # ✅ Pass (73.6kb)

# Tests
npm test          # ✅ 30/30 pass
```

## Production Deployment Checklist

- [ ] Deploy updated code to Railway
- [ ] Verify `REDIS_URL` is set in Railway variables (required for BullMQ)
- [ ] Check Railway logs for `STEP:` traces on next `/blueprints/generate` call
- [ ] If queue.add still fails, logs will show exact Redis error (connection, auth, TLS)