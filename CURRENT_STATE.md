# StartupOS Backend — Current State

## Overview

| Attribute | Value |
|-----------|-------|
| Version | 2.0.0 |
| Language | TypeScript (ESNext modules) |
| Runtime | Node.js 22 |
| Framework | Fastify v5 |
| Database | PostgreSQL (Prisma ORM) |
| Queue | BullMQ (Redis) |
| AI Providers | FreeLLMAPI, Groq, OpenRouter (fallback chain) |
| Deployment | Vercel API (or mock) |
| Auth | JWT (jsonwebtoken + bcrypt) |
| Validation | Fastify schema + Zod (AI responses only) |
| Test Framework | Vitest |

## Architecture

```
Fastify Server (server.ts)
  ├── Rate Limiter (100 req/min)
  ├── CORS
  ├── Swagger (API docs at /docs)
  │
  ├── Auth Routes (/auth/register, /auth/login, /auth/me)
  ├── Startup Routes (/startups)
  ├── Blueprint Routes (/blueprints/generate, /blueprints/:id)
  ├── Website Routes (/websites/generate, /websites/:id)
  ├── Deployment Routes (/deployments/create, /deployments/:id)
  └── Job Routes (/jobs/:id)
       │
       └── BullMQ Queue ──┬── Worker (3 job types)
                          │    ├── BLUEPRINT_GENERATION
                          │    ├── WEBSITE_GENERATION
                          │    └── DEPLOYMENT
                          │
                          └── Monitor (timeout cleanup)
```

### Module Breakdown

#### `src/lib/`
| File | Purpose | Lines |
|------|---------|-------|
| `env.ts` | Zod-validated environment config | 43 |
| `errors.ts` | AppError hierarchy + error handler | 56 |
| `jwt.ts` | JWT sign/verify helpers | 13 |
| `logger.ts` | Pino logger (pretty-print in dev) | 13 |

#### `src/db/`
| File | Purpose | Lines |
|------|---------|-------|
| `client.ts` | Prisma singleton (globalThis caching) | 11 |

#### `src/middleware/`
| File | Purpose | Lines |
|------|---------|-------|
| `auth.ts` | Bearer token → `request.user` middleware | 24 |

#### `src/types/`
| File | Type | Lines |
|------|------|-------|
| `auth.ts` | JwtPayload, AuthRequest + Fastify declaration merge | 15 |
| `ai.ts` | AIProvider interface, BlueprintResult, WebsiteSpecResult, PageHTMLResult | 67 |
| `job.ts` | JobResponse, JobQueuePayload | 19 |

#### `src/modules/`
| Module | Routes | Handlers | Schemas | Lines |
|--------|--------|----------|---------|-------|
| `auth/` | 3 (register, login, me) | 3 handlers | Zod schemas defined but **unused in handlers** | 180 |
| `startups/` | 4 (create, list, get, delete) | 4 handlers | Zod schemas defined but **unused in handlers** | 213 |
| `blueprints/` | 2 (generate, get) | 2 handlers | Zod schema for input only | 170 |
| `websites/` | 2 (generate, get) | 2 handlers | Zod schema for input only | 165 |
| `deployments/` | 2 (create, get) | 2 handlers | Inline body typing | 193 |
| `jobs/` | 1 (get by ID) | 1 handler | None | 79 |

#### `src/queue/`
| File | Purpose | Lines |
|------|---------|-------|
| `setup.ts` | Redis connection, Queue, QueueEvents, Worker factory, close | 82 |
| `worker.ts` | Job processor with 3 case handlers + Prisma updates | 347 |
| `monitor.ts` | Stuck job timeout detection (30s interval) | 46 |

#### `src/services/`
| Service | Files | Purpose |
|---------|-------|---------|
| `ai/` | `provider.ts` (574), `validation.ts` (98) | 3 AI provider implementations + fallback chain + Zod validation |
| `deploy/` | `types.ts`, `builder.ts`, `vercel.ts`, `verify.ts` (total 194) | Vercel API deployment + file building + verification |
| `renderer/` | `index.ts`, `validate.ts`, `fallbacks/home.ts` (total 332) | AI page rendering + validation + fallback templates |

### Database Schema (Prisma)

7 models: `User`, `Startup`, `Blueprint`, `WebsiteSpec`, `Website`, `Deployment`, `Job`, `ApiLog`

### Test Coverage

| Test File | Tests | Coverage Area |
|-----------|-------|---------------|
| `website-generation.test.ts` | 15 | Validation schemas, fallback templates, page/website validation |
| `ai-lawyer-example.test.ts` | 3 | End-to-end fallback generation, format validation |
| `deployment.test.ts` | 6 | File builder, manifest generator |
| `vercel-deploy.test.ts` | 3 | Vercel provider, verify method |
| `e2e-deploy.ts` | Manual | Real AI + Vercel deployment |
| `e2e-deploy-mock.ts` | Manual | Mock deployment |
| `run-verification.ts` | Manual | Full pipeline verification |

**Missing tests:** Auth endpoints (register, login, me), Startup CRUD, Blueprint generation handler, Deployment handler, Queue worker, Monitor, Error handler, Middleware, Rate limiting.

## Dependencies

### Production (14)
`@fastify/cors`, `@fastify/rate-limit`, `@fastify/swagger`, `@fastify/swagger-ui`, `@prisma/client`, `bcrypt`, `bullmq`, `dotenv`, `fastify`, `ioredis`, `jsonwebtoken`, `pino`, `pino-pretty`, `zod`

### Dev (8)
`@types/bcrypt`, `@types/jsonwebtoken`, `@types/node`, `esbuild`, `prisma`, `ts-node`, `tsx`, `typescript`, `vitest`

## Environment Variables (27 total)

- 6 required (NODE_ENV, PORT, HOST, DATABASE_URL, JWT_SECRET, LOG_LEVEL)
- 3 conditionally required (at least one AI key: GROQ_API_KEY, FREELLM_API_KEY, OPENROUTER_API_KEY)
- 3 optional (REDIS_URL, REDIS_HOST, REDIS_PORT)
- 4 Supabase (never used in code)
- 1 Vercel (optional)
- 3 timeout config variables

## Current Build Status

- `npm run build`: Uses esbuild, bundles to single `dist/server.js`
- `npx tsc --noEmit`: TypeScript checking
- `npm test`: 24 tests via Vitest
- Docker: Multi-stage build (builder + runner)

## Deployment

- No current production deployment
- Railway config: `.env.deploy` provided
- Docker Compose: local dev with Postgres + Redis + app
- Vercel deployment: optional (requires `VERCEL_TOKEN`)