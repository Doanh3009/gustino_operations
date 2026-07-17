# Testing Configuration

- Repository root: `D:\gustino`
- Application: React 19 + TypeScript + Vite 6
- Backend modes discovered: Supabase/PostgreSQL and LAN/local fallback
- UI automation dependency: `playwright-core`
- Existing test style: executable Node QA/smoke scripts; no unit-test runner configured in `package.json`
- Production safety: no destructive production tests; prefer local/demo or explicitly isolated QA data
- Primary build command: `npm.cmd run build`
- Existing packaged QA command: `npm.cmd run qa:roles`
- Environment keys found (names only): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `ZALO_OA_ACCESS_TOKEN`, `ZALO_GMF_GROUP_ID`, `N8N_REPORT_WEBHOOK_URL`, `N8N_REPORT_WEBHOOK_TOKEN`, `N8N_REPORT_ENABLED`
- Test accounts/endpoints: pending source-backed inventory
- In-app Browser status on 2026-07-15: unavailable (`agent.browsers.list()` returned `[]`); do not substitute another browser-control backend under the active browser skill.
- Vercel environment readback on 2026-07-15: Production exposes `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `CRON_SECRET`; all are shown by Vercel as encrypted/sensitive values. Never print or persist server-secret values locally.
- Production build guard: always run `node scripts/test-production-supabase-bundle.mjs` after the build and before deployment. The generated `.vercel/.env.production.local` can be stale/empty; explicitly supply the two public Vite values during local prebuild and verify the emitted asset rather than assuming environment hydration.
- Linked migration history warning (verified 2026-07-17): local files use repeated eight-digit date versions while production history uses fourteen-digit versions, so `supabase db push --linked --dry-run` refuses. Never use history repair, `--include-all`, force or bulk replay as a deployment shortcut; first run the read-only runtime/predeploy/latest-object audits and reconcile history only in a dedicated reviewed operation with backup and an explicit version map.

This configuration is provisional until discovery is complete.
