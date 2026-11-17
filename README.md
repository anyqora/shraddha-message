# Shraddha Message

Self-hosted WhatsApp Cloud API panel — contacts, lists, templates, broadcast campaigns and a shared inbox.
Next.js 16 · MySQL / MariaDB (Drizzle ORM) · Tailwind. Layout inspired by Twenty CRM (own code, no Twenty source).

## Features
- **Contacts** — add/edit, CSV & Excel import with column mapping, custom fields, search & filters, opt-out flag
- **Lists** — segment contacts for campaigns
- **Templates** — sync from Meta, create new ones (text/image/video/document header, variables, footer, buttons), live preview, status (Pending/Approved/Rejected)
- **Campaigns** — send now or schedule, audience from a list or an uploaded file, map variables to contact fields / file columns / fixed text, throttled sending, pause/resume, retry failed, report (sent/delivered/read/failed)
- **Inbox** — conversations, text/media/template replies, 24-hour window indicator, delivery ticks
- **Opt-out** — replies like STOP / UNSUBSCRIBE opt the contact out automatically (START opts back in)
- **Team** — admin & agent users

## Local development
```bash
cp .env.example .env.local   # fill DATABASE_URL etc.
npm install
npm run dev                  # tables are created automatically on start
```
Open http://localhost:3000 — the first visit goes to `/setup` to create the admin.

## Deploy on Hostinger (Web App + GitHub)
1. **MySQL**: hPanel → Websites → msg.… → Databases → create database + user. Note name, user, password.
2. **Web app**: hPanel → Web Apps → msg.shrddhaconsultancypro.in → Deployments → Settings and redeploy →
   *Import Git repository* → connect GitHub → choose this repo, branch `main`.
   - Framework: Next.js · Node 22 · Build: `npm run build` · Output: `.next`
3. **Environment variables** (Web app → Environment variables):
   ```
   DATABASE_URL=mysql://DBUSER:DBPASS@localhost:3306/DBNAME
   ENCRYPTION_KEY=<64 hex chars>
   CRON_SECRET=<random string>
   APP_URL=https://msg.shrddhaconsultancypro.in
   APP_NAME=Shraddha Message
   ```
   URL-encode special characters in the DB password (`#` → `%23`, `@` → `%40`).
4. Deploy. Every `git push` to `main` redeploys automatically.
5. Open the site → `/setup` → create the admin → **Settings** → WhatsApp details → *Test connection*.
6. **Meta webhook**: callback `https://msg.shrddhaconsultancypro.in/api/webhook/whatsapp`, verify token from Settings, subscribe to `messages`.
7. **Cron** (hPanel → Advanced → Cron Jobs, every minute):
   ```
   curl -fsS --max-time 60 -H "x-cron-secret: <CRON_SECRET>" https://msg.shrddhaconsultancypro.in/api/cron/campaigns
   ```
   Scheduled campaigns start from here; "Send now" also starts immediately.

## Data from the old panel (Neon)
`node scripts/export-from-neon.mjs > migration/neon-import.sql` (needs `OLD_DATABASE_URL`), then import the file in phpMyAdmin
after the app has started once. The access token is not copied — enter it again in Settings.

## Database changes
Edit `src/db/schema.ts`, run `npm run db:generate`, commit the new file in `drizzle/`. Migrations run automatically on start.
