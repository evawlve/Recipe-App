### PR Checklist

- [ ] API routes include `runtime='nodejs'`, `dynamic='force-dynamic'`, `revalidate=0`
- [ ] No top-level heavy imports in routes; heavy logic moved to `*.server.ts`
- [ ] No server component fetches `/api/**` (server code uses server libs)
- [ ] `DATABASE_URL` still points at pooler (6543) with `pgbouncer=true&connection_limit=1&sslmode=require`
- [ ] Verified Vercel deploy passes (no "Failed to collect page data")

### Notes
Add any context needed for reviewers (migrations, cron endpoints, secrets, etc.).


