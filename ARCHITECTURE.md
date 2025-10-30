## Architecture and Guardrails (Vercel-friendly)

### API Routes
- Export the following on every route file:
  - `export const runtime = 'nodejs'`
  - `export const dynamic = 'force-dynamic'`
  - `export const revalidate = 0`
- No top-level heavy imports in routes (Prisma, auth, AWS SDK, large JSON). Use dynamic imports inside handlers.
- For complex logic, create server-only modules in `src/lib/**/**/*.server.ts` and call them from the route.

### Server vs Client Boundaries
- Server components and server code must not `fetch('/api/**')`. Call server libraries directly.
- Client components may call API routes.

### Database Configuration
- `DATABASE_URL` must point to the Supabase Session Pooler (port 6543) with:
  - `pgbouncer=true&connection_limit=1&sslmode=require`
- Use `DIRECT_URL` (port 5432) only for migrations if needed. Never hardcode direct URLs in app code.

### Middleware
- Middleware must bypass: `/api`, `/_next`, `/images`, `/static`, `/favicon.ico`, `/auth`.
- Only guard interactive pages.

### Cron Jobs
- Prefer Vercel Cron or GitHub Actions that call our cron endpoints with `X-Cron-Secret`.
- Avoid running Prisma or long TypeScript jobs directly inside Actions.

### Health/Diagnostics
- Keep lightweight endpoints for quick checks: `/api/diag/env` and `/api/diag/db` (or `/api/ok`).

### Large Data Assets
- Keep large data assets server-only. Do not import them in client bundles.
- Use streaming/fs readers from `*.server.ts` modules.

### Summary
Following these rules ensures reliable Vercel deploys, prevents pool exhaustion, and keeps the server/client boundary clean for performance and DX.


