# Contributing

Use Node.js 22+ and pnpm. Run `pnpm install`, copy `.dev.vars.example` to `.dev.vars`, and run `pnpm db:migrate:local` before `pnpm dev`.

Keep marketplace rules in `packages/core/src/platforms/` and UI messages in `apps/web/src/i18n/ja.ts`. Preserve the free-tier limits, local photo processing, and gentle game feedback. Never add marketplace scraping, unofficial API access, or automatic posting.

Before submitting a PR, run `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm test:e2e`. Browser tests start their own local Worker with isolated D1 storage. Install Chromium with `pnpm exec playwright install chromium`; system Google Chrome is a fallback. `pnpm shots` generates the nine demo captures in `/workspace/mercari-harness/shots/` using separate local storage.

Do not commit secrets or generated local databases. CI validates changes and never deploys. Deployment and remote migrations are separate, explicit operator actions.
