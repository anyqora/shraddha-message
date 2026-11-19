# Rebuilding the staging UI in source

The live staging app runs a **redesigned UI** (Twenty-CRM style) plus a few extra features on top of upstream
wacrm @ `c81299d`. Its source is lost. Only the compiled Next.js build survives, in
`/Users/keval/kk-projects/wacrm-staging-build/`. The goal is to make this repo's UI **look and behave the same
as staging**, written as normal readable TSX that matches this codebase's style (shadcn/ui, Tailwind v4,
next-intl `useTranslations`, `@/lib/supabase/client` for data).

## Where the staging code lives
- **Client components (the UI):** `wacrm-staging-build/.next/static/chunks/*.js`. These are minified
  Turbopack chunks. React elements look like `(0,t.jsx)("div",{className:"...",children:[...]})`. Tailwind
  class strings, i18n keys, `supabase.from("table")` calls and icon names all survive minification.
- **Which chunks belong to which page:**
  `wacrm-staging-build/.next/server/app/(dashboard)/<page>/page_client-reference-manifest.js`. The SSR side of
  the same components is under `.next/server/chunks/ssr/*` and is often easier to read.
- **Finding a component:** grep for a distinctive string (an i18n key from `messages/en.json`, a CSS class, a
  label) across `.next/static/chunks` and `.next/server/chunks/ssr`. Pretty-print a chunk with
  `npx prettier --parser babel < chunk.js > /tmp/x.js`.
- **UI strings:** the staging strings are already in `messages/*.json`. Use those keys.
- **Icons:** staging uses `@tabler/icons-react` 3.50.0 as well as `lucide-react`. Its full dependency list is
  in `docs/mysql-port/staging-ref/package.json`.

## Reference screenshots and tools
- **Staging screenshots** (logged in, 1440×900):
  `/private/tmp/claude-501/-Users-keval-dd-projects-admin/f5cefdbd-82d3-4c5f-8082-0fd4efbc372f/scratchpad/shots/staging/*.png`
- **This repo running locally** (same data): `.../scratchpad/shots/local/*.png`
- **Screenshot tool** (takes local screenshots after your changes):
  `cd .../scratchpad/shots-tool && PATH=$HOME/.local/node/bin:$PATH node shots.mjs http://localhost:3000 <outDir> /path1 /path2 ...`
  It logs in and saves `<outDir>/<path>.png`, printing console errors and HTTP 5xx. Use only
  `http://localhost:*` as the base URL. If you need a staging screenshot that doesn't exist yet, ask the
  coordinator for it in your report.
- **Local dev server:** already running at http://localhost:3000 (`next dev`, hot reload), backed by a local
  MySQL holding the staging data. Locally you may create and edit test data freely.

## Data layer contract (do not change)
- **Browser code:** `import { createClient } from '@/lib/supabase/client'`. It is a supabase-js compatible
  client backed by MySQL: `from/select/insert/update/upsert/delete`, filters, `order/range/single`, embeds like
  `contact:contacts(name)`, `rpc`, and `channel(...).on('postgres_changes', ...)`.
- **Server and admin code:** server uses `import { createClient } from '@/lib/supabase/server'`; admin uses
  `@/lib/supabase/admin`.
- **Tables:** every table staging uses already exists, including `companies`, `tasks`, `views`,
  `contacts.opted_out` and `broadcasts.scheduled_at` (see `db/mysql/migrations/0001_init.sql`).
- **Don't edit:** `src/lib/db/**`, `src/lib/supabase/**`, `src/proxy.ts`,
  `src/app/api/{db,auth,realtime,storage}`, or the migration. If you need a schema change, add
  `db/mysql/migrations/0002_<name>.sql` and report it.

## Ownership (avoid edit conflicts between parallel workers)
| area | owner |
|---|---|
| App shell: `src/app/(dashboard)/layout.tsx`, `dashboard-shell.tsx`, sidebar, topbar, breadcrumb, page-header actions, command palette (Search ⌘K), workspace switcher. Theme defaults: `src/lib/themes.ts`, `globals.css`, root `layout.tsx`. Dashboard page and its components, `/privacy` page, auth page styling | **shell** |
| Shared record table system, Contacts page and contact components, Companies page, Tasks page, contact import (Excel/CSV), saved views | **records** |
| Broadcasts (list, new/scheduled, cancel, detail), `/api/broadcasts/cron`, `/api/whatsapp/broadcast/[id]/cancel`, opt-out (webhook STOP/START, contact flag), Inbox page and inbox components | **messaging** |

Touch files outside your area only with a minimal edit, and list them in your report.

## Done means
- Local screenshots of your pages match staging at 1440×900: layout, spacing, typography, colours, icons,
  empty states and toolbar actions.
- The interactions you can see in staging work locally against MySQL.
- `npx tsc --noEmit` and `npx eslint <your files>` are clean. Run the vitest tests for files you touched, and
  update tests that asserted the old upstream UI.
- There are no secrets in the code. Nothing is committed; the coordinator commits.
