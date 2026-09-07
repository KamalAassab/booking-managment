# Atelier Planning — Project Brief (handoff document)

> This file is a full record of the planning conversation for a new booking/reservations
> platform for **L'Atelier Groupe**. Paste or upload this whole file into a new session
> so it has complete context — nothing here has been built yet, this is a requirements
> and architecture record only. No code exists for this new project yet.

---

## 1. Business context

The client is **L'Atelier Groupe**, a group of beauty/wellness salons in El Jadida,
Morocco, with an existing marketing website (separate project, `Atelier`, already built:
Next.js 16 + TypeScript + Tailwind v4 + Neon Postgres + Drizzle, deployed on Vercel,
with an owner-only `/admin` dashboard for offers/transformations/fleet).

The group has **3 physical salons**:
- L'Atelier VIP (flagship)
- L'Atelier Gold
- L'Atelier Barber Shop & Spa

The owner contacted the developer about a **new, separate project**: an internal booking
/ reservations management platform, not part of the public marketing site. The existing
`Atelier` project was only referenced for business context (salon names, existing infra
choices) — this new system is a standalone codebase.

## 2. The problem being solved

The owner is running two parallel booking intake channels that currently have no shared
system behind them:

1. **A call center of 4 agents** who answer phone calls. A client calls, states a desired
   date/time/service, and gives their info verbally. The agent must book the reservation
   **while still on the call** — so the booking UI must be fast, low-friction, and give
   instant feedback.
2. **One front-desk person per salon** (3 people total), each working at a desk with
   **two monitors**:
   - Screen A: the live calendar of that salon's day, which is also the place they
     click to add/edit a booking directly (interactive, not just a passive display).
   - Screen B: Instagram/WhatsApp open, where clients message asking for bookings; the
     front-desk person reads the request there and keys it into Screen A.

There is **no big wall-mounted TV** — that idea from earlier in the conversation was
superseded. "The screen" the owner described *is* the front-desk person's monitor,
not a separate passive display for stylists. Scrap the TV-broadcast concept entirely.

## 3. Finalized decisions (confirmed with the owner, do not re-litigate these)

- **One single shared login for everyone.** All 4 call-center agents and all 3
  front-desk people use the exact same one account — no individual per-user logins,
  no per-salon-scoped accounts.
- **Fully anonymous bookings.** No "booked by" attribution field. The owner explicitly
  said fully anonymous shared use is fine; do not add a name-picker.
- **Separate owner/admin login** (small addition on top of the above, not litigated
  again with the owner but sensible and uncontested): for changing the shared
  password, viewing all three salons at once, and future reporting. Build it, but keep
  it minimal — this project is primarily the shared booking tool.
- **No big TV / passive display screen** — only the front-desk person's own
  interactive monitor per salon (see §2).
- **Salon selection lives in the app, not in the login** — since the account isn't
  scoped per salon, the calendar screen needs a salon selector (VIP/Gold/Barber).
  Default each device/browser to remember its last-used salon (e.g. via
  localStorage) so front-desk people aren't re-selecting their own salon constantly.
- **Zero-delay double-booking prevention is a hard requirement.** Implement via a
  database-level uniqueness constraint on (salon, date, time slot) so a conflicting
  write is rejected atomically, instantly, even from two different devices hitting
  the same shared account at once. Additionally, the calendar view itself should
  update live (not on a slow poll) across all connected devices/tabs so a slot
  disappears for everyone the instant it's taken — not just blocked silently on save.
- **WhatsApp confirmation — final approach (read this carefully, several wrong paths
  were explicitly ruled out first):**
  - ❌ NOT the official WhatsApp Business Platform / Cloud API. This would require
    migrating the owner's *existing* WhatsApp Business number off the regular phone
    app, losing that number's chat history, and needing Moroccan business
    verification (RC/ICE/IF) + a Business Solution Provider (360dialog/Twilio/etc.).
    The owner rejected this — he wants to keep using the existing number and app
    exactly as-is for manual client chats.
  - ❌ NOT unofficial WhatsApp Web automation libraries (e.g. whatsapp-web.js,
    Baileys) that would auto-send without any click. This was explicitly discussed
    and flagged as carrying a real risk of WhatsApp banning the salon's main number
    (losing all chat history and that communication channel entirely), plus being
    unstable long-term (breaks silently on WhatsApp app updates, no support channel).
    Given the whole point of this project is long-term reliability, this path was
    rejected.
  - ✅ **FINAL APPROACH:** Use WhatsApp's own official "click-to-chat" deep link
    (`https://wa.me/<phone>?text=<prefilled message>`) combined with WhatsApp's
    **linked companion devices** feature. The free WhatsApp Business app supports the
    primary phone **plus up to 4 additional simultaneously-linked companion
    devices** (WhatsApp Web/Desktop sessions) on the same number — which conveniently
    matches the number of call-center agents exactly.
    - **One-time setup:** link each of the 4 agents' computers as a companion device
      via QR scan from the owner's phone (Settings → Linked Devices). Stays linked
      indefinitely as long as the phone touches the internet at least once every 14
      days (trivially satisfied, it's the owner's actively used phone).
    - **At runtime:** when an agent clicks Submit on a booking, the app opens a new
      browser tab to a pre-filled `wa.me` link addressed to the client's number, with
      the confirmation message text already written. Because that browser is already
      linked, it opens straight into the compose box — the agent taps Send once
      (under a second), without breaking the flow of the phone call.
    - This is **one click to send, not fully zero-click** — a script cannot press
      WhatsApp's own Send button without crossing back into unofficial-automation
      territory, which was already ruled out. One click is the correct, safe ceiling
      here — do not attempt to make this literally automatic without opening this
      decision back up with the owner first.
    - No official Business API, no BSP, no per-message cost, no business
      verification, no migration of the existing number. The number keeps working
      exactly as it does today in the regular app.
    - **Front-desk people do not need this feature.** They already have an open
      Instagram/WhatsApp thread with the client when they book (that's how the
      client contacted them), so they just reply manually in that existing thread.
      The pre-filled-tab shortcut is only wired into the **call-center agent's**
      booking flow, since agents have no existing chat thread (they came from a
      phone call).

## 4. Data model (draft, not yet built)

- `users` — for the small number of accounts that do exist (the one shared
  staff account, the owner account). Simple, not a large user base.
- `salons` — VIP, Gold, Barber Shop & Spa (seed data).
- `bookings` — salon, client name, phone (normalized to international format,
  e.g. `+212...`, needed for the wa.me link), date, time, service, notes, status
  (confirmed/cancelled/done), timestamps. Unique constraint on (salon, date, time)
  to enforce the zero-delay double-booking rule.

## 5. Screens (draft, not yet built)

- `/login` — one shared staff login + a separate owner login.
- `/bookings` — the shared calendar screen used by both call-center agents and
  front-desk people: salon selector (remembers last used per device), day/time grid
  of existing bookings, add/edit a booking, live updates across all open sessions.
  On submit, if the booking came from the call-center flow, auto-open the
  pre-filled `wa.me` confirmation tab.
- `/owner` (or similar) — owner-only: change the shared password, view all three
  salons at once, future reporting.

**Not in scope unless asked later:** SMS/email confirmations, payment handling, a
public-facing booking form (the public site's existing WhatsApp form is untouched
and separate), per-agent accountability/attribution.

## 6. Infra & recurring cost plan (researched, prices as of Sept 2026)

- **Hosting:** Vercel **Pro** plan, $20/seat/month. (Hobby/free tier's terms restrict
  it to non-commercial personal projects, so it's not appropriate for a paying
  client's production app.)
- **Database:** Neon Postgres, **Launch** plan (usage-based, $0.106/CU-hour +
  $0.35/GB-month storage, no monthly minimum). At this app's tiny scale (a handful
  of users, low query volume) realistic cost is roughly **$0–10/month**.
- **Domain name:** ~$10–15/year.
- **Error monitoring:** Sentry free tier is sufficient at this scale.
- **Uptime monitoring:** UptimeRobot free tier.
- **Estimated total recurring cost to the developer: ~$25–35/month.** This is the
  floor a monthly retainer to the client needs to cover, plus margin.
- **WhatsApp confirmations add $0 recurring cost** given the final approach in §3
  (no official API, no per-message billing, no BSP subscription).
- No separate TV hardware needed anymore (the TV-display concept was dropped, see
  §2) — the front-desk monitors are presumably existing office equipment, not a new
  purchase driven by this project.

## 7. Reliability practices for the "run for years without breaking" goal

- TypeScript strict mode throughout.
- Targeted automated tests on the two places bugs would actually hurt the business:
  the double-booking conflict logic, and login/access control. Not blanket coverage
  of everything.
- Boring, mature, pinned-version stack (Next.js + Postgres) — avoid unstable/
  bleeding-edge dependencies that get abandoned.
- Vercel preview deployments before every production push.
- Sentry error alerts so bugs are caught by monitoring, not by a phone call from
  the owner.
- Neon point-in-time recovery for accidental data corruption/bulk-edit mistakes.
- A quarterly maintenance pass (dependency + security updates) — this is what
  actually keeps a codebase healthy years out, more than any one-time build
  decision. Should be reflected in the recurring retainer fee, not treated as free
  ongoing labor.
- No promise of literally zero bugs was made to the owner — that's not a realistic
  claim from any developer. The promise is: fails rarely, fails safely, cheap and
  fast to fix when it does.

## 8. Pricing framework discussed (not a fixed number — needs the developer's own rate)

Two separate line items, don't fold them together:
1. **One-time build fee** — scoped to: shared login + owner login, booking CRUD with
   conflict checking, the salon-selector calendar screen, the wa.me confirmation
   hookup, basic owner admin screen, testing, deployment setup, and training the
   staff. No reliable local (El Jadida/Morocco) freelance-rate benchmark was
   available to anchor this — the developer should check comparable local
   small-business software quotes rather than use a global average.
2. **Monthly hosting + support retainer** — should at minimum cover the ~$25–35/month
   recurring cost from §6, plus margin for the quarterly maintenance pass and any
   support requests. A flat retainer (not "invoice only when something breaks") is
   what makes the long-term reliability promise sustainable for the developer.

## 9. Immediate next step (where the conversation left off)

Everything in §3 was confirmed. The very next action, not yet started, is:
**scaffold the actual `atelier-planning` Next.js project** (folder already created at
`C:\Users\4B\Desktop\Projects\atelier-planning`, currently empty except for this
brief) — i.e. `create-next-app`, wire up Drizzle + a new Neon project/database
(separate from the existing Atelier project's database), build the `users` /
`salons` / `bookings` schema from §4, and build the screens from §5, starting with
the shared `/bookings` calendar screen since that's the core of the whole system.

No code has been written yet. A fresh session picking this up should start there.
