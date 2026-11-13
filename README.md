# True Series Academy - Phases 1 to 4

Node.js, Express, EJS, Sequelize (PostgreSQL), Tailwind CSS (compiled), Font Awesome, Brevo email, Google sign-in, Paystack. Brand: deep green and gold.

## Run it

Tailwind is compiled: `npm install` builds `public/css/tailwind.css` automatically (postinstall). While developing,
run `npm run dev:css` in a second terminal to rebuild on every change, and `npm run dev` for the server. If the
stylesheet has not been built yet, pages fall back to Tailwind's browser build with the same colours and component
classes, so nothing looks broken. Colours live in `tailwind.config.js`, component classes in `src/input.css`.

Developer demo data: `npm run seed` (or `npm run seed:reset` to wipe first). It prints the logins and what to try.
It refuses to run in production, and refuses to wipe a database that is not on your computer unless you add `--yes`.

```bash
cp .env.example .env      # fill in DATABASE_URL, SESSION_SECRET, SUPERADMIN_EMAIL (and Google / Brevo keys)
npm install
npm run dev
```

On start the app runs `sequelize.sync({ alter: true })`, creates the default roles, and promotes the account whose
email matches `SUPERADMIN_EMAIL` to superadmin (register with that email first, then restart, or just register after
the app is running: the role is assigned at sign-up).

- Without `BREVO_API_KEY`, emails are printed to the console (the verification link is in the log), so you can test locally.
- Without Google keys, the Google buttons are hidden. Google redirect URI: `APP_URL/auth/google/callback`.

## What is in Phase 1

- Email/password sign-up with email verification (24h link), password reset, rate limiting, CSRF protection
- Google sign-up and sign-in, with method checks:
  - Google-created account tries a password -> told to use Continue with Google
  - Password account signs in with Google (same verified email) -> accounts are linked
  - Unverified password account later claimed through Google -> the old password is discarded
- Roles built from granular permissions, editable in /admin/roles (you can only grant what you hold)
- Admin: overview, homepage banners (upload, schedule, order), users (role, suspend, view as), roles, settings, audit log
- "View as" another user, with a banner and every action logged under your name
- Landing page modelled on the reference site: hero slider (one banner per program) with progress rail, how it works,
  scholarships, what you get, FAQ
- One-time community modal (WhatsApp channel/group, Telegram), remembered per account or per browser
- Browser time zone captured for signed-in users (used for sessions in Phase 3)

## What Phase 2 adds

- **Programs and cohorts.** A program is the reusable template; a cohort is one run of it (dates, seats, fee,
  scholarship %, entry mode, community links). Cohort status: draft, open, closed, completed, suspended.
  Program status: draft, published, suspended, archived.
- **Four entry modes per cohort:** free, pay (Paystack unlocks enrollment), application (form, quiz, offer, seat
  fee), community (join links only).
- **Application flow.** Details form, one-time quiz, automatic result:
  at or above the pass mark -> offer (or waiting list if seats are full); between grace mark and pass mark -> manager
  review; below -> not selected. Offers expire after the cohort's offer window; a cron job (every 10 minutes)
  releases unpaid seats and offers them to the waiting list by score, then time.
- **Manager workflow.** Queue sorted by score, one-click "Approve with grace", and manual decisions
  (offer, waitlist, do not select, extend, retake quiz). Manual decisions need a reason, are stored with the
  application and written to the audit log. Manual offers may exceed the seat limit.
- **Program-scoped staff.** Roles with scope "program" (manager, instructor, moderator by default) only work
  through a program's Team page. The same person can sit on many programs. Managers add their own team but cannot
  appoint managers or grant permissions they do not hold.
- **Students.** Per cohort: search, suspend, reactivate, remove (a removal frees the seat for the waiting list).
- **Paystack.** Checkout redirect, browser callback verification and a signed webhook, all idempotent; amounts are
  checked against what was recorded when the payment started.
- **Homepage banners** can link to a program (button goes to its page, its banner is used if none is uploaded).

## What Phase 3 adds

- **Sessions per cohort.** Title, description, start, length, optional lead, and a pasted Google Meet or Zoom link
  (anything else is rejected). Schedule one session or a weekly series (up to 26). Cancel and restore; delete only
  while nobody has joined. Times are entered in Lagos time and shown to everyone in their own time zone.
- **The Join gate.** Students open a session page. The Join button works from N minutes before the start (default 15,
  set per session) until the end. Pressing it (a POST, so link previews and crawlers cannot trigger it) records
  attendance, then sends the student to the meeting. The meeting link is never in the page source.
  Not enrolled, suspended, cancelled, too early, too late, or "viewing as" someone: no join, no attendance.
- **Attendance.** Per session: who pressed Join, when, how many times, newest at the bottom of the list, so moderators
  can match names with the people waiting in the meeting (auto-refreshes while live). Instructors and managers can mark
  someone present by hand with a reason. Per cohort: a students x sessions matrix with attendance %, compared with the
  cohort's required %, plus a CSV download. Cancelled sessions do not count.
- **Reminders (cron, every 5 minutes).** One email the day before and one an hour before, per enrolled student, sent
  once even with several servers. Students can switch them off on their account page.
- **Workflow tasks (cron, every 15 minutes).** The system notices a session starting within 72 hours with no meeting
  link, and applications waiting for review. People with the right permission on that program get an email; if the task
  runs late the program manager gets one; a day later the owner. Tasks close themselves when fixed. They also show on
  the admin overview and on /admin/tasks.
- **Student side.** Session page with countdown and "Add to calendar" (.ics, without the meeting link), cohort page with
  upcoming and past sessions and your attendance vs the required %, "Coming up" on the dashboard, and a new account
  page for your name (printed on certificates), time zone and reminder emails.

## What Phase 4 adds

- **Levels.** Counted from what a person has done, nothing stored: 10 XP per session joined, 5 per recording watched,
  100 per certificate. Six levels (Newcomer to Master) shown on the dashboard; managers see each student's level on
  the cohort Students page.
- **Recordings.** YouTube links per cohort (watch, youtu.be, embed, live and shorts links are understood; only the
  11-character id is stored), optionally tied to a session. Shown in a privacy-enhanced embed to enrolled students,
  and still available after the cohort ends. Use Unlisted videos; the id can still be found by someone who inspects the page.
- **Dive back in.** The dashboard shows finished cohorts with their recordings and certificate, and "continue watching".
  **Suggested for you** ranks open cohorts by shared category and tags with what the student has taken.
- **Certificates.** Marking a cohort completed issues certificates to everyone at or above the cohort's attendance rule
  (switch off per cohort). Managers can issue by hand, issue anyway with a reason, withdraw and restore. Each has a code
  like TSA-K7PQ-2M9X, a printable page with the student's exact name, a PDF download, and a public /verify page that shows
  genuine, withdrawn or not found (never an email address). Details are copied at issue time, so later edits do not change them.
  The PDF is generated without a library; it uses plain Latin letters, so accents and dots under letters are dropped there.

## Hosting on Render's free plan

- `GET /ping` (also `/healthz`) is a cold endpoint: it answers `ok` before the session and database middleware, sets no
  cookie and never touches Postgres. Point the keep-alive at it.
- `node scripts/keepalive.js https://your-app.onrender.com` pings it every 14 minutes (or `--once` for cron).
  Run it on any machine that stays on. `.github/workflows/keepalive.yml` does the same from GitHub if you set an
  `APP_URL` repository variable. A sleeping service cannot wake itself, so it must not run on the service.
- This matters beyond load times: the reminder emails, offer expiry and task nudges are cron jobs inside the app and only
  run while the service is awake.
- Render's disk is wiped on every restart, so set the three Cloudinary variables to keep uploaded banners.
- `render.yaml` is a starting blueprint. Check Render's current free-plan limits before launch, in particular how long
  the free Postgres database lives.

### Paystack setup

1. Put `PAYSTACK_SECRET_KEY` in `.env`.
2. In the Paystack dashboard set the webhook URL to `APP_URL/webhooks/paystack`.
3. Callback URL is sent per transaction (`APP_URL/payments/callback`), nothing to configure.

### Upgrading from Phase 1

Run the app once: `sync({ alter: true })` adds the new tables and columns, and a one-time migration marks
manager/instructor/moderator as program-scoped roles and adds the new permissions to existing built-in roles.
Anyone who was given one of those three roles globally in Phase 1 loses that access until you add them to a
program's Team page.

## Notes

- Tailwind runs from its CDN script so there is no build step. Before production, switch to the Tailwind CLI and
  turn on the Helmet CSP in `server.js`.
- Banner uploads go to `public/uploads/slides`. Move to Cloudinary if you deploy somewhere with an ephemeral disk.
- Slide buttons of type "Program details page" take any link for now; Phase 2 links them to cohorts.
- Certificates, levels, recordings and related-program suggestions arrive in Phase 4. Attendance percentages are already tracked for the certificate rule.
- Built-in roles gain the new `attendance.manage` permission through a one-time migration on first start.
