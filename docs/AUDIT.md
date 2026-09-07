# Backend and database audit

The deployed app answered with Next.js's default error page — a warning
triangle, "A server error occurred", and a digest number. This is what was
behind it, and what else the audit turned up on the way.

Every finding below was reproduced before it was fixed, and the fix verified
against a real PostgreSQL 16 and a production build of the app.

---

## 1. The 500 itself: an unmigrated database crashed every page

`listSalons()` threw SQLSTATE `42P01` — `relation "salons" does not exist` —
straight out of the `/bookings` server component. Nothing caught it, so
Next.js rendered its default error page.

The guard that was supposed to handle this,

```ts
const salons = await listSalons();
if (salons.length === 0) return <SetupNotice />;
```

was unreachable: the query throws, so there is never an empty array to count.

**Fixed** — the query is wrapped, and a missing schema, an unreachable
database, and missing configuration each render a page naming the problem and
the command that fixes it. `/api/health` reports the same thing as JSON.

## 2. `DATABASE_URL` missing took down `/login` too

`src/db/index.ts` read the variable at module scope and threw if it was
absent. `/login` imports the login server action, which imports the database
module, so a Vercel project with the variable not yet set could not render
even the sign-in page — the one screen that does not need a database.

A malformed value was worse: `new URL(...)` threw `TypeError: Invalid URL`,
with nothing to say which variable was at fault.

**Fixed** — the connection is built on first use behind a `Proxy`, so
importing the module is free. Bad configuration raises a typed `ConfigError`
carrying a hint, and `/login` renders normally without a database.

## 3. Double booking was reported as a crash

The most serious finding, because it is the system's single most important
guarantee and it looked like it worked.

The database was right the whole time — the GiST exclusion constraint rejects
overlaps correctly. The bug was in reading the error:

```ts
const code = (error as { code?: string })?.code;   // always undefined
```

Drizzle 0.45 does not rethrow the driver's error. It wraps it in a
`DrizzleQueryError` whose own `message` is `"Failed query: insert into ..."`
and whose `code` is `undefined`; the real `PostgresError`, with the SQLSTATE
and the constraint name, is on `.cause`.

So `isSlotConflict()` never matched, and two agents racing for the same slot
saw:

> Erreur serveur. Réessayez. *(HTTP 500)*

instead of:

> Ce créneau vient d'être réservé sur un autre poste. *(HTTP 409)*

The 500 also skipped the grid refresh that shows the agent who took the slot.

**Fixed** — `src/lib/db-errors.ts` walks the whole `cause` chain, matching on
SQLSTATE, then constraint name, then message, and covers both the
node-postgres and Neon HTTP error shapes. Verified end to end: identical slot
→ 409, overlapping range → 409, back-to-back → 201.

## 4. `+212 0612345678` produced a phone number belonging to nobody

Someone reading their number off a saved contact gives you the country code
*and* the trunk zero. The old code saw a leading `+` and trusted the rest
verbatim, storing `+2120612345678` — thirteen digits, not a real number.

The agent then opened a WhatsApp chat with an unknown recipient, mid-call,
with nothing on screen to say anything was wrong.

**Fixed** — the trunk zero is stripped after the country code, `00`-prefixed
numbers are recognised even when dictated in groups (`00 212 612 345 678`),
and anything that is not a plausible phone number is now rejected outright
rather than reduced to digits and dialled.

## 5. A booking could be sold twice across midnight

`start_min` was constrained to 0–1439 and `duration_min` to positive, but
nothing bounded their sum. A 23:00 booking of two hours stored the range
`int4range(1380, 1500)`.

The exclusion constraint only compares rows sharing a `booking_date`, so the
two hours that booking really occupies the following morning were invisible
to it — and bookable again.

**Fixed** — `bookings_within_day` in `drizzle/0002_guards.sql`, mirrored by a
check in the application so the agent gets a sentence rather than a
constraint violation.

## 6. SSE could not work on Vercel

`/api/stream` held a connection open for four minutes, polling the database
once a second from inside it. Three separate problems:

- A function instance is held for the whole life of every open tab. Seven
  staff with the calendar open all day is seven functions running
  continuously — billed compute, far past the cost ceiling in the brief, and
  enough to stop the Neon compute ever scaling to zero.
- Four minutes exceeds the default function duration, so the stream was
  killed and reconnected on a loop, leaving a gap each time.
- A database that had gone away produced an error event every second, per
  client, for four minutes, with no backoff.

**Fixed** — replaced with `/api/bookings/watermark`, polled every two seconds
by each visible tab. Same perceived latency, a few tens of milliseconds of
compute per check instead of continuous, exponential backoff on failure, and
no timeout to design around.

## 7. Smaller findings

| | |
|---|---|
| `updateBooking` silently skipped the opening-hours check when the salon row was missing, letting a booking be moved anywhere | Now raises `NotFoundError` |
| An empty `PATCH` body bumped `updated_at`, waking every open calendar for a write that changed nothing | Returns the row unchanged |
| Re-cancelling an already-cancelled booking did the same | Only live rows are touched |
| `changeStaffPassword` reported success even when the `UPDATE` matched no rows — the owner would tell the team a password that does not work | Checks the row count |
| `slotMin` of 0 made the grid generator loop forever | Guarded, plus a `salons_slot_positive` constraint |
| `formatLongDate` / `todayInSalonTz` threw `RangeError` on bad input during server rendering | Every time helper is now total |
| A year typo like `0202` reached the database | Range-checked to 2000–2100 |
| Unlimited login attempts against two shared passwords on a public URL | Per-IP exponential backoff |
| `createBooking` dereferenced `rows[0]` without checking | Fails loudly instead |
| A booking's name or service could be whitespace | `btrim` CHECK constraints |

## What was already right

Worth recording, because the audit did not change it:

- The GiST exclusion constraint is correct, and does exactly what it claims.
  Every double-booking scenario tested — identical slots, partial overlaps, a
  long booking swallowing later slots, back-to-back bookings, re-booking a
  cancelled slot — behaves correctly at the database level.
- Session cookies are `httpOnly`, signed, role-scoped, and reject tampering,
  expiry and role escalation.
- Passwords are salted scrypt with parameters stored alongside the hash.
- Storing times as minutes-from-midnight and dates as plain strings means no
  timezone can move a booking to the wrong day.
- No credential appears in any committed file.

## Test coverage

The suite went from 46 tests to 212, all passing. Some deliberate gaps
remain: this is a suite aimed at the paths where a bug costs money, not at a
coverage percentage.
