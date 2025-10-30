## Cursor Agent Rules

### API Routes
- Always export on every API route:
  - `export const runtime = 'nodejs'`
  - `export const dynamic = 'force-dynamic'`
  - `export const revalidate = 0`
- Do not add top-level heavy imports (Prisma, auth, AWS SDK, large JSON). Use dynamic imports within the handler.
- Move heavy/complex logic to `src/lib/**/**/*.server.ts` and call it from the route.

### Server vs Client
- Never fetch `/api/**` from server components or server code; import and call server libs.
- Client components may call API routes.

### Large Data Assets
- Keep large assets server-only (do not import in client bundles). Use streaming/fs readers in `*.server.ts`.

### Database URLs
- Preserve session pooler semantics for `DATABASE_URL` (port 6543) with `pgbouncer=true&connection_limit=1&sslmode=require`.
- Do not hardcode direct URLs; `DIRECT_URL` (port 5432) is for migrations only.

### Cron
- Prefer cron endpoints + Vercel Cron. Avoid running Prisma or long TS jobs directly in GitHub Actions.

### Middleware
- Ensure middleware bypasses `/api`, `/_next`, `/images`, `/static`, `/favicon.ico`, `/auth`.


