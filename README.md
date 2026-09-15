# Atelier Planning

Internal booking / reservations platform for **L'Atelier Groupe** — three
salons in El Jadida (VIP, Gold, Barber Shop & Spa).

Two intake channels share one system: four call-centre agents booking while
the client is still on the phone, and one front-desk person per salon keying
in requests that arrive by Instagram/WhatsApp. Requirements and the decisions
behind them are recorded in [`PROJECT_BRIEF.md`](./PROJECT_BRIEF.md).

This is not the public marketing site — it is a separate, staff-only tool.

## Stack

| | |
|---|---|
| Framework | Next.js 16 (App Router) · React 19 · TypeScript strict |
| Styling | Tailwind CSS v4, no webfont |
| Database | Neon Postgres via Drizzle ORM |
| Auth | HMAC-signed session cookie, scrypt password hashing (`node:crypto`) |
| Hosting | Vercel |

Every dependency is pinned to an exact version. There are no runtime
dependencies outside this table — no auth library, no websocket service, no
component kit — which is the point: the fewer moving parts, the fewer things
that break unattended over the years.

## Getting started

```bash
npm install
cp .env.example .env.local     # fill in DATABASE_URL and SESSION_SECRET
npm run db:migrate             # create the schema
npm run db:seed                # 3 salons + the staff and owner accounts
npm run dev
```

The seed prints the initial passwords once. Set `SEED_STAFF_PASSWORD` and
`SEED_OWNER_PASSWORD` in `.env.local` first if you would rather choose them.

`npm run check` runs typecheck, lint and tests together.

### Running against a local Postgres

`DATABASE_URL` decides the driver: a `*.neon.tech` host uses Neon's HTTP
driver, anything else uses node-postgres. So the whole app — migrations
included — runs against a plain local database with no Neon project:

```bash
DATABASE_URL='postgres://postgres@127.0.0.1:5432/atelier' npm run db:migrate
```

## Screens

| Route | Who | What |
|---|---|---|
| `/login` | everyone | Role toggle (Personnel / Propriétaire) + password. No username field — there is one shared staff account. |
| `/bookings` | staff + owner | One salon's day, week or month. Click a free slot to book, click a booking to edit, cancel or mark done. |
| `/clients` | staff + owner | Every client, grouped by phone number, with their booking history. |
| `/owner` | owner only | All three salons for a given day, and the two password forms. |
| `/owner/services` | owner only | Each salon's service catalogue — names, durations, prices. The booking sheet and the WhatsApp message use it. |

### Device settings (per browser, `localStorage`)

The shared account is not scoped to a salon, so each browser remembers its
own preferences:

- **Salon** — a front desk reopens on its own salon rather than re-picking it
  every morning.
- **Poste** — `Réception` or `Appels` (call centre), chosen in the sidebar.
  This is a property of the desk, not of a person: it is recorded on every
  booking as its `channel`. Nothing about it is attributed to a user.

## How the two hard requirements are met

### Double-booking cannot happen

Two devices signed into the same shared account must never both win the same
slot. That guarantee lives in the database, not in application code, so it
holds no matter how the write arrives:

```sql
ALTER TABLE bookings ADD CONSTRAINT bookings_no_overlap
  EXCLUDE USING gist (
    salon_id WITH =, booking_date WITH =,
    (lower(btrim(service))) WITH =,
    int4range(start_min, start_min + duration_min) WITH &&
  ) WHERE (status <> 'cancelled');
```

An exclusion constraint rather than a plain unique index because bookings have
durations: a 90-minute coloration at 14:00 has to block 14:30 and 15:00 too.
The rule is per service — different services run side by side, one chair
each — and a service is compared ignoring case and surrounding spaces, so a
custom service typed as "Coupe enfant" and "coupe enfant" is still one chair.
A partial unique index on `(salon_id, booking_date, lower(btrim(service)),
start_min)` sits alongside it for the common same-slot collision. Cancelled
rows are excluded from both, so cancelling frees the slot immediately.

The API turns SQLSTATE `23505`/`23P01` into a 409 and the message *"ce créneau
vient d'être réservé sur un autre poste"*. The booking sheet stays open with
everything the agent typed, refreshes the grid so its own conflict warning
shows who took the slot, and the agent picks another time. The rare deadlock
between two agents' writes meeting inside the constraint is retried, never
shown as a server error. The client also greys out slots it knows are busy —
but that is a courtesy, never the guarantee.

### The calendar updates live

`/api/bookings/watermark` returns a change token for one salon and one day:
the row count and a digest of every row version (`xmin`) in it. Each visible
tab polls it every 750 ms and gets the day's bookings back in the same
response only when the token moves. The week and month views also pass the
span they show, so a booking made on any visible day reaches them too. A slot
disappears for everyone within about a second of being taken.

The token is a digest rather than the newest `updated_at`: with several
agents saving at once, a write routinely commits a few milliseconds after a
later one a screen has already seen, and a newest-timestamp token never
notices it — that screen stayed stale until something else changed.

Deliberate choices:

- **Not Server-Sent Events**, which is what this was until the audit in
  `docs/AUDIT.md`. An SSE endpoint holds a serverless function open for the
  whole life of every tab: seven staff with the calendar open all day is seven
  functions running continuously, which is billed compute and well past the
  cost ceiling in the brief. It also outlived Vercel's function duration
  limit, so it was killed and reconnected on a loop.
- **Not Postgres `LISTEN/NOTIFY`**, which would be the textbook answer but
  needs a long-lived direct connection that serverless functions cannot hold.
- **Polling stops when the tab is hidden.** A browser left open overnight
  would otherwise keep the Neon compute awake.
- **Failures back off exponentially**, capped at 10 seconds, so a database
  having a bad minute is not hammered by every open browser at once.
- **Responses are checked against what is on screen.** Answers arrive in any
  order; one for the day or salon the agent just left is stored in the cache
  but never drawn over the day they moved to.
- **`BroadcastChannel`** updates other tabs in the same browser instantly,
  without waiting for the next poll.

## WhatsApp confirmations

When a booking is created from the booking sheet, the app opens a tab to
WhatsApp's own official click-to-chat link with the confirmation message
pre-filled — date, time, service, the price from the salon's catalogue (or
the one typed in the sheet) and any note. Because an agent's browser is a
linked companion device on the salon's number, it opens straight into the
compose box and the agent presses Send once.

The tab is pointed at WhatsApp only after the server has accepted the
booking. A booking refused because another desk took the slot a moment
earlier closes the blank tab again — a client is never sent a confirmation
for a booking that does not exist.

The salon's own number — the account the confirmations go out from — is
**+212 766 092 140**, recorded in `src/lib/salon-contact.ts` and shown on the
owner screen. Override it per environment with `SALON_WHATSAPP_NUMBER`. It is
configuration rather than a database column because there is exactly one of
it and it is read but never written.

**One-time setup:** on the owner's phone, WhatsApp → Settings → Linked
Devices, and scan the QR code from each of the four agents' computers. The
free WhatsApp Business app allows four companion devices, which matches the
number of agents exactly. Links stay active as long as the phone connects to
the internet at least once every 14 days.

What this deliberately is **not**, and why (see brief §3):

- **Not the WhatsApp Business Platform / Cloud API.** It would require
  migrating the owner's existing number off the phone app, losing that
  number's chat history, plus Moroccan business verification and a BSP.
- **Not an unofficial automation library** (whatsapp-web.js, Baileys). Those
  carry a real risk of the salon's main number being banned, and break
  silently on WhatsApp updates.

One click to send is the correct ceiling here. Do not try to make it literally
automatic without reopening that decision with the owner — doing so means
crossing back into the unofficial-automation territory that was already ruled
out.

The popup is opened synchronously inside the submit handler so popup blockers
allow it; if it is blocked anyway, the success toast carries the link instead
so the step is never silently lost.

## Data model

- **`users`** — exactly two rows: the shared `staff` account and the `owner`.
- **`salons`** — the three salons, each with its own opening hours and slot
  length, so the owner can change hours without a code change.
- **`bookings`** — salon, client name, phone (E.164), date, start minute,
  duration, service, notes, status, channel.
- **`services`** — each salon's catalogue, edited from `/owner/services`.
  Seeded from `src/lib/services-catalog.ts`, which also stands in for a salon
  that has no rows yet.

Bookings are **fully anonymous**: there is no "booked by" column anywhere.
`channel` records *how* a booking arrived (call centre vs front desk), never
*who* took it.

### Times and dates

Times are stored as **minutes from midnight** (`14:30` → `870`) and dates as
plain `YYYY-MM-DD` strings. Nothing in the booking path constructs a `Date`
from user input, so a server running in UTC and a browser in
Africa/Casablanca can never disagree about which day a booking is on. "Today"
is resolved through `Intl` in the salons' own timezone.

## Tests

`npm test` runs the full suite. It covers the places a bug actually costs the
business money, rather than chasing blanket coverage. There are three layers.

**Logic** (`tests/*.test.ts`, no database needed):

- **Double-booking logic** — overlap detection, back-to-back bookings, long
  bookings swallowing later slots, cancelled slots becoming reusable, editing
  a booking without it conflicting with itself.
- **Request validation** — every field at its boundary, the French message
  for each mistake, notes that can be removed, control characters.
- **Auth and access control** — password hashing and verification, forged and
  expired session cookies, role escalation attempts, missing secrets.
- **Phone normalisation and the WhatsApp link** — if a number is normalised
  wrong the agent opens a chat with the wrong person, mid-call, with no
  visible error — and the price the client is quoted.
- **Driver error classification** — which database refusals become 409, 400
  or 503, including the error shapes both drivers really throw.
- **Login throttling** and the **deployment health checks**.

**Database** (`tests/integration/`, runs when `TEST_DATABASE_URL` is set,
skips itself otherwise — `truncateAll()` refuses any other database):

- the constraints themselves, with raw inserts that bypass the application;
- `src/lib` and every route handler: status codes, auth, 400 rather than 500
  for any malformed request (fuzzed), the live-update token under writes that
  commit out of order;
- the server actions (login, passwords, the owner's catalogue);
- migration 0005 refusing atomically on conflicting data;
- **five users at once** (`tests/scenarios/multi-user.ts`): the same slot
  raced by five desks, overlapping durations, simultaneous moves, cancels and
  revivals, five live screens converging on the database's day, a simulated
  shift of agents retrying the next free slot, and 1,000 randomized
  operations checked response-by-response against an independent model.
  Every scenario ends by checking that nobody saw a 5xx and that the database
  holds no double booking.

```bash
TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/atelier_test npm test
```

The database must be UTF-8 and migrated (`DATABASE_URL=… npm run db:migrate`).
Add `TEST_NEON_HTTP=1` to run the same database suites through the Neon HTTP
driver production uses: `tests/helpers/neon-http-emulator.ts` stands in for
Neon's SQL-over-HTTP endpoint in front of the local database, so result
parsing and `NeonDbError` handling are exercised exactly as deployed.
`tests/helpers/run-with-neon-emulator.ts` runs `scripts/migrate.ts` or
`scripts/seed.ts` the same way.

**Over HTTP** (`tests/e2e/`): the five-user scenarios again, against a
production build served by `next start` in its own process, with the server
pointed at the same database and signing with the same `SESSION_SECRET`:

```bash
E2E_BASE_URL=http://127.0.0.1:3100 TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/atelier_e2e SESSION_SECRET=<the server's secret> npx vitest run tests/e2e
```

## Deployment (Vercel)

### Setting up the database without a terminal

`npm run db:migrate && npm run db:seed` is the normal route, but it needs a
machine with the repository checked out. If you only have a phone, or the
database is behind a network you cannot reach from where the code is,
[`docs/neon-setup.sql`](./docs/neon-setup.sql) does the same job in one paste:
open the Neon console, go to the **SQL Editor**, paste the whole file, Run.

It creates the schema, applies every migration, adds the double-booking
constraint, inserts the three salons, their service catalogues and both
accounts, and records the migrations so a later `npm run db:migrate` sees them
as already applied. It ends with a count you can check at a glance, and
re-running it is safe — salons are upserted, a salon's catalogue is only
seeded while it has none, and existing accounts are left alone, so a password
you have already changed is never reset. Pasted over a database set up with
an older copy of the file, it also upgrades the double-booking rule to the
current one.

Change both passwords from the owner screen once you are signed in.

### Locked out — resetting a password you don't know

The owner screen changes a password only if you can supply the current one,
and neither the seed nor `docs/neon-setup.sql` overwrites an account that
already exists. So a password that was never written down, or a fresh deploy
where the seed ran with no `SEED_OWNER_PASSWORD` set (it prints a random one
once, to logs you may not have kept), leaves you signed out with no way back
in through the app. `/login` says only "Mot de passe incorrect." — the
database is fine; the password just isn't the one you're typing.

To set a known one:

```
npm run db:reset-password -- owner 'the-new-password'
```

This connects to nothing. It hashes the password locally and prints a single
`INSERT ... ON CONFLICT DO UPDATE`. Paste that into the Neon console's **SQL
Editor** and Run — a browser is all it needs, so it works from a phone — and
the account can sign in with the new password immediately. The upsert also
creates the row if the account was never seeded at all. Use `staff` in place
of `owner` for the shared staff password. Existing sessions stay signed in,
so change it again from the owner screen afterwards if you'd rather not have
the password sitting in your shell history.

### The normal route

1. Import the repository, framework preset **Next.js**.
2. Environment variables: `DATABASE_URL` (Neon pooled connection string) and
   `SESSION_SECRET` (a fresh 32-byte random value — not the development one).
   Paste the **value only**. A `.env` file is read by dotenv, which strips the
   quotes around a value; Vercel's dashboard stores exactly what was pasted,
   so the line copied out of `.env.example` arrives with its apostrophes
   still attached. The app now trims them and says so on `/api/health`, but
   they should not be there.
3. Run `npm run db:migrate` and `npm run db:seed` once against the production
   database.
4. Open `/api/health`. It reports whether the environment variables, the
   database connection, each table and the double-booking constraint are all
   in place, and names the command to run for whatever is missing. Do this
   before handing the URL to anyone.

   When the database is the problem it says which kind: an endpoint that
   answered with an HTTP status (rejected credentials, a deleted project, a
   Neon outage) reads differently from a request that never arrived, and
   neither is reported as a failed query. It never prints the connection
   string, and the host it shows has the project's own segment masked.
5. Keep preview deployments on, so every change is seen working before it
   reaches the salons.

`btree_gist` is created by the migration; Neon supports it out of the box.

## When something is wrong

`/api/health` is the first place to look. It answers without a session —
deliberately, because the thing that is broken is often signing in — and
reports only presence and shape, never a value: no connection string, no
host, no secret.

```
{ "status": "fail",
  "checks": [ { "name": "table:salons", "state": "fail",
                "detail": "Missing — run `npm run db:migrate`." } ],
  "nextStep": "Missing — run `npm run db:migrate`." }
```

The three states a fresh deployment can be in — environment variable not set,
database unreachable, tables never created — each render a page saying which
one it is and what to run, rather than a blank server error. See
`docs/AUDIT.md` for how they used to behave.

## Maintenance

Recurring cost sits around **$25–35/month** (Vercel Pro, Neon Launch, domain;
Sentry and UptimeRobot free tiers). WhatsApp confirmations add nothing — no
API, no per-message billing, no BSP subscription.

Plan a quarterly dependency and security pass. That, more than any decision
made during the initial build, is what keeps this running for years.

## Known scope boundaries

Not built, by agreement (brief §5): SMS/email confirmations, payment
handling, a public-facing booking form, and per-agent attribution.

Worth knowing:

- Changing the shared staff password does not sign out browsers that are
  already signed in — sessions are stateless. That is the right trade for a
  front desk that must not be logged out mid-day; if invalidating live
  sessions ever matters, rotate `SESSION_SECRET`, which signs everyone out.
- `drizzle-kit` pulls in a transitively vulnerable `esbuild` (a dev-server
  advisory). It is a build-time-only tool and never ships to production;
  fixing it upstream means downgrading drizzle-kit by thirteen minor
  versions, which would be the worse trade.
