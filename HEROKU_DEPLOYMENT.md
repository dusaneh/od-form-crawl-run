# Heroku staging deployment

This repository is prepared for the existing Heroku application
`onedeg-intake-form-staging`. The normal source of truth is the connected
GitHub repository, `1deg/intake-automation`, branch `main`. Do not alternate
between GitHub deployments and direct pushes to the Heroku Git remote.

## Runtime layout

One Heroku `web` process owns `$PORT` and acts as the public gateway:

- `/` — public API-service landing page;
- `/healthz` — public, minimal platform health response;
- `/api/*` — authenticated crawl, report, approval, and execution APIs;
- `/control-plane` — authenticated operations UI;
- `/api-console` — authenticated client API explorer;
- `/login` — UI sign-in.

Only the designated administrator may view `/control-plane`. The authenticated
`/api-console` remains available to regular operators, while
`/ops/audit-log` remains available to administrators.

The gateway starts the Vinext production UI and crawler API on loopback-only
internal ports (defaults `13000` and `18787`, independently configurable).
Static client assets are served directly by the gateway.
PostgreSQL is authoritative; `/tmp/formweave-cache` is disposable.

Hosted mode is headless-only and refuses localhost/private-network targets.
Headful browsing and loopback fixture submission remain workstation features.
Authenticated operators and API tokens may create crawls and form executions
only for the exact `https://testforms.dbolab.io` origin. The designated
administrator account (`dbosmail@gmail.com`) is the only identity authorized
to use other public origins or view `/control-plane`; this privilege is not
inherited by API tokens or by the general administrator role.

## One-time Heroku setup

The existing app must use these buildpacks in this order:

1. `heroku-community/apt`
2. `heroku/nodejs`

`Aptfile` contains the Linux libraries required by Playwright Chromium.
`app.json` records the intended setup for review/new apps, but it does not
retroactively change an existing app's buildpacks.

Attach Heroku Postgres if `DATABASE_URL` is not already present. The release
phase in `Procfile` runs every versioned migration before the web process is
replaced.

Set these config vars:

```text
OPENAI_KEY=<server-side secret>
OPENAI_MODEL=gpt-5.4-mini
OPENAI_SEMANTIC_MODEL=gpt-5.4-mini
FORMWEAVE_STORAGE=postgres
FORMWEAVE_CACHE_DIR=/tmp/formweave-cache
FORMWEAVE_AUTH_MAX_FAILURES=5
FORMWEAVE_AUTH_LOCKOUT_SECONDS=900
FORMWEAVE_SESSION_SECONDS=28800
PLAYWRIGHT_BROWSERS_PATH=0
```

Heroku supplies `DATABASE_URL`. Do not copy `.env` into Heroku or Git.
Managed Postgres connection startup can occasionally be slow. The application
pool allows 45 seconds to establish a connection, retains idle connections for
60 seconds, and the release migration retries transient connection failures.
`POSTGRES_CONNECT_TIMEOUT_MS` and `POSTGRES_IDLE_TIMEOUT_MS` may override those
defaults if staging telemetry demonstrates a need.

## Seed UI users and the development API token

`access.md` is gitignored and exists only on the trusted workstation. It
contains the generated plaintext bootstrap credentials. The database stores
salted scrypt password hashes and a digest of the high-entropy API token.

From the trusted workstation, point `POSTGRES_URI` at the staging database and
run:

```powershell
npm run auth:seed -- access.md
```

Clear the temporary local database environment variable afterward. Never set
the plaintext credential block as a Heroku config var.

## Deploy through GitHub

This checkout currently uses another GitHub repository as `origin`. Add the
One Degree repository without overwriting that remote:

```bash
git remote add one-degree https://github.com/1deg/intake-automation.git
git fetch one-degree
```

Push a feature branch, open a pull request, and merge it into
`1deg/intake-automation` `main`. The Heroku GitHub integration shown in the
app dashboard is configured to automatically build and deploy that branch.

The deploy performs:

1. Node dependency installation;
2. the Vinext production build;
3. a Playwright Chromium download into the slug;
4. the PostgreSQL release migration;
5. startup of the authenticated production gateway on `$PORT`.

## Verify the release

From this trusted checkout:

```powershell
$env:FORMWEAVE_SMOKE_URL = "https://onedeg-intake-form-staging.herokuapp.com"
npm run smoke:production
Remove-Item Env:FORMWEAVE_SMOKE_URL
```

The smoke test verifies public health, protected UI routing, Basic-to-session
login, Bearer API access, lockout, and hosted browser/target restrictions.
Then perform one harmless public crawl and verify polling, report retrieval,
schema retrieval, screenshot retrieval, approval, dry-run execution, and
execution polling.

## Current staging limitation

Crawl and execution work still runs inside the web dyno after the asynchronous
API creates its record. PostgreSQL preserves completed state, but a deploy or
dyno restart can interrupt an active browser job. A durable worker queue is
the next production-hardening step. Start staging with one browser job at a
time and a dyno size validated against Chromium memory use.
