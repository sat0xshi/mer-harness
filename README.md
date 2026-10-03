# Mer Harness

**English** | [日本語](README.ja.md)

> Make listing and shipping on Mercari Japan feel like a game you actually want to play.

> ⚠️ **Unofficial.** Mer Harness is not affiliated with, endorsed by, or connected to Mercari, Inc. "Mercari" is a trademark of Mercari, Inc. This app **never accesses Mercari automatically**. You paste the text into the official Mercari app yourself.

<!-- Add screenshots to docs/shots/ and link them here -->
<!-- ![Capture](docs/shots/capture.png) ![Questions](docs/shots/questions.png) ![Board](docs/shots/board.png) -->

## Features

- **Photo → polished images**: square crop, brighten, and an optional white background, all in your browser.
- **Question cards**: answer brand, condition, size, accessories and flaws, and the listing text grows live as you go.
- **Price helper**: paste or type sold comparables. The app builds a Mercari sold-items search URL for you to open. You get 3 price suggestions with net proceeds after the fee.
- **Copy screen**: copy title, description and price, save images, open Mercari, then tap "listed!".
- **Inventory board**: draft / listed / trading / to ship / done, plus an unsold shelf.
- **Game layer**: XP, levels, streaks, combos, badges, and big "pikon!" celebrations with WebAudio-synthesized sounds (no audio files), confetti and haptics. It respects `prefers-reduced-motion` and never guilt-trips you.
- **Optional AI assist** (Cloudflare Workers AI free tier): photo → brand/model/flaw suggestions, and a screenshot of sold listings → extracted prices. There is a daily cap, and the app works fully without AI.
- **Shipping navi** (planned): size judge, Rakuraku / Yuyu Mercari-bin suggestion, packing checklist.

## Why

Selling on Mercari is easy to start and tedious to keep up. The two biggest hurdles are **writing the listing** (photos, wording, pricing) and **figuring out shipping**. Both feel like chores, so items pile up in a drawer. Mer Harness turns them into small, quick steps with instant feedback, so "I'll do it later" becomes "done in two minutes."

## Disclaimers

- **Unofficial** and not affiliated with, endorsed by, or connected to Mercari, Inc.
- "Mercari" is a trademark of Mercari, Inc. The logo in this project says "Harness" only.
- **Never accesses Mercari or any other marketplace site.** No scraping, no unofficial APIs, no auto-posting; the app only builds a search URL that *you* open.
- **No scraping, no unofficial APIs, no auto-posting.** Mercari's terms prohibit accessing the service through interfaces it doesn't provide, so this app doesn't. You copy the text and post it in the official app yourself.
- Price suggestions are rough guides based on data you provide. You are responsible for your listings and for following Mercari's rules.

## How it works

1. Take a photo, then crop, brighten and optionally whiten the background on-device.
2. Answer the question cards. The title and description build themselves.
3. Enter sold comparables and pick one of 3 suggested prices.
4. Copy everything, post it in the Mercari app, and tap "listed!".
5. Track the item on the inventory board until it's done.

**Privacy:** EXIF and GPS data are stripped on your device before anything is stored. No buyer data is stored. Photos are saved as small JPEG blobs in your own D1 database.

**Stack:** a single Cloudflare Worker with Static Assets (Vite + React + TypeScript SPA, Hono API under `/api`), D1 as the source of truth (no R2, no paid features), Workers AI, pnpm workspaces (`apps/web`, `apps/worker`, `packages/core`), and Vitest.

**Free-tier first:** designed to run at **$0** on Cloudflare Workers Free. Things stop at the caps rather than bill you.

## Self-hosting

### Local development

Prerequisites: Node.js 22+, pnpm, and a Cloudflare account (only needed to deploy).

```sh
pnpm install
cp .dev.vars.example .dev.vars   # gitignored
pnpm db:migrate:local
pnpm dev
```

Local dev uses `wrangler dev` with a local D1 and bypasses auth through `.dev.vars`.

### Staging setup (manual; nothing deploys automatically)

The existing staging D1 is `mer-harness-stg` (`7fe02d97-df73-40d0-be54-a34c6c5f0ade`). No resource creation is needed for this configuration. Self-hosters must supply their own database and hostname.

Staging defaults to `AUTH_MODE=google`. Create a Google OAuth **Web application** client and register the exact app origin (for this staging configuration, `https://furima-harness-stg.sat0xshi.com`) under Authorized JavaScript origins. Set `GOOGLE_CLIENT_ID` in staging vars. Google Identity Services displays the login button; the Worker verifies RS256, audience, issuer, expiry, verified email, and exact `OWNER_EMAIL`, then sets a signed 30-day HttpOnly/Secure/SameSite=Lax session cookie. See [Google's verification guide](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token).

Set secrets interactively (never add them to `wrangler.jsonc` vars):

```sh
pnpm exec wrangler secret put OWNER_EMAIL --env staging
pnpm exec wrangler secret put SESSION_SECRET --env staging
# SESSION_SECRET: use a random value of at least 32 characters (e.g. openssl rand -hex 32).
# Only when ready to change the remote environment:
pnpm db:migrate:staging
pnpm deploy:staging
```

`db:migrate:staging` applies D1 migrations remotely; `deploy:staging` builds then deploys only staging. Neither runs during CI. The Google client ID is currently a placeholder, so deployed authentication fails closed until configured. Local bypass works only with `APP_ENV=development`, `DEV_AUTH_BYPASS=1`, and a loopback request hostname.

For `AUTH_MODE=access`, configure a Cloudflare Access application and owner-only policy for the app hostname, then set its `ACCESS_AUD` and `ACCESS_TEAM_DOMAIN`. The Worker verifies the Access JWT and exact owner email. Google credentials are unused in this mode. `/api/auth/logout` clears the Google session cookie; Access logout is managed by Cloudflare Access. Rotate `SESSION_SECRET` to invalidate all Google sessions.

Production retains placeholders. After separately configuring production resources, vars and secrets and obtaining deployment approval, the manual command is `pnpm build && pnpm exec wrangler deploy --env production`. There is no production deploy script or CI deploy job.

## Configuration

| Variable | Location / description |
| --- | --- |
| `APP_ENV` | Vars: `development`, `staging`, `production` |
| `AUTH_MODE` | Vars: `google` or `access`; required outside local bypass |
| `GOOGLE_CLIENT_ID` | Vars: Google Web OAuth client ID; required in Google mode |
| `OWNER_EMAIL` | **Secret**: the only allowed email; required in both modes |
| `SESSION_SECRET` | **Secret**: random HMAC key, at least 32 characters; required in Google mode |
| `ACCESS_AUD` | Vars: Access application audience; required in Access mode |
| `ACCESS_TEAM_DOMAIN` | Vars: `<team>.cloudflareaccess.com`; required in Access mode |
| `AI_ENABLED` | Vars: `1` to enable optional AI, `0` to disable |
| `AI_DAILY_LIMIT` | Vars: daily AI call cap |
| `DEV_AUTH_BYPASS` | `.dev.vars` only: `1` for local development; never deploy it |

Platform adapters live in `packages/core/src/platforms/` (`PlatformConfig`, registry, Mercari only). Items store a platform ID; migration `0002_platform.sql` defaults existing rows to `mercari`. Fees, shipping, limits, condition labels, copy order/format, search hints/URLs, currency and locale belong to the adapter. UI messages live in `apps/web/src/i18n/ja.ts`; English/Chinese UI translations are deferred.

### Checks and screenshots

```sh
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm shots
```

Browser tests use Chromium (system Google Chrome if the bundled browser is missing) and start an isolated local Worker. `shots` seeds demo items and XP through the API, uses a generated test photo, and saves nine 390×844 PNGs under `/workspace/mercari-harness/shots/`. These commands do not deploy or contact marketplace sites.

## Roadmap

- [x] Photo → listing text → price → copy flow
- [x] Inventory board and game layer
- [x] Optional AI assist
- [ ] Shipping navi: size judge, Rakuraku / Yuyu Mercari-bin suggestion, packing checklist
- [ ] More polish on the unsold shelf and price tips
- [ ] More marketplaces via small platform adapters (`packages/core/src/platforms/`): Yahoo! Auctions, Yahoo! Flea Market, Rakuma (fees, shipping, text limits, copy format)
- [ ] i18n (en / zh) and overseas marketplaces (currency/locale live in the platform config)

## Contributing

Issues and pull requests are welcome. Please keep changes free-tier friendly, never add anything that touches Mercari automatically, and run `pnpm test` before opening a PR. Keep the tone of the game kind: no guilt-tripping.

## Security

No secrets belong in this repo. `.dev.vars` is gitignored, and the example file contains placeholders only. To report a vulnerability, please use GitHub's [security advisories](https://github.com/sat0xshi/mer-harness/security/advisories/new) rather than a public issue.

## License

[MIT](LICENSE) © 2026 sat0xshi
