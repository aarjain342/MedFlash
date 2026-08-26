# MedFlash — Session Handoff

Read this first. It captures the full history, architecture, and known gotchas from building
this app so far, so a fresh session doesn't have to rediscover them the hard way.

## What this is

**MedFlash** — upload a lecture PDF/PPTX/DOCX, get AI-generated Anki-style flashcards
(slide-by-slide, with tables/mnemonics/slide images), study them with a Leitner-style flip
mode, and take adaptive USMLE-style quizzes generated from the deck's own content. Has
Supabase auth, cross-device sync, and a small AI chat assistant.

**Live**: frontend on Vercel, backend on Render, DB/auth on Supabase.
**Repo**: https://github.com/aarjain342/MedFlash (public — see security notes below).

## Architecture

```
client/   React 19 + Vite, plain CSS (no framework), react-router-dom
server/   Express (ESM), single process, no build step
Supabase  Postgres (decks, quizzes tables with RLS) + Auth (email/password)
```

**Deploy targets**:
- Frontend: Vercel, auto-deploys on push to `main`. URL: `med-flash-gamma.vercel.app`
- Backend: Render, auto-deploys on push to `main`. URL: `medflashcards.onrender.com`
  (service name in Render's dashboard may not match `render.yaml`'s `medflash-backend` —
  it's been renamed there before; identify the right service by its live URL, not name.)
- Supabase project ref: `nkvulihdbvkzkiewanan`

**LLM providers**: Gemini (primary, ~10-model fallback chain since individual Gemini models
have surprisingly small/inconsistent free-tier quotas) → Groq (secondary vendor fallback,
completely separate quota pool, text-only — no vision-capable models on that key). See
`server/src/providers/gemini.js` and `groq.js` for the exact model lists; these needed
real API probing to get right, don't guess new model names without testing against
`GET https://generativelanguage.googleapis.com/v1beta/models?key=...` first — Gemini model
availability/naming changes fast and deprecates without much warning.

## Key files (backend)

- `server/src/index.js` — all routes: `/api/generate-stream` (PDF/PPTX/DOCX → flashcards,
  SSE), `/api/generate-quiz` (deck cards → USMLE questions, SSE), `/api/chat` (medical Q&A),
  `/api/health` (reports rate-limit config, useful for confirming a deploy actually landed).
- `server/src/documentSource.js` — dispatches PDF (mupdf) vs PPTX vs DOCX to the right extractor.
- `server/src/pdf.js` — mupdf-based PDF text+image extraction. Images are encoded as both
  PNG and JPEG, whichever is smaller kept (PNG wins on flat/text slides, JPEG wins big on
  photo-like anatomy slides — this was the fix for a real "statement timeout" bug).
- `server/src/officeDocs.js` — PPTX (hand-rolled, unzips with `fflate` + regex over
  `<a:t>` runs, slide order resolved via `presentation.xml.rels`, NOT filename order) and
  DOCX (via `mammoth`, then chunked into slide-sized pieces since Word docs have no
  inherent "slide" concept).
- `server/src/llm.js` — `generateWithFallback()`, the shared provider/model fallback walker
  used by both flashcard and quiz generation.
- `server/src/quiz.js` — quiz prompt (styled after a specific example the user provided:
  2nd/3rd-order reasoning only, 5 options A-E, clinical vignettes) + `sanitizeQuestions()`
  (validates LLM output shape — this exists because a malformed question object from a
  weaker fallback model literally crashed the whole server once, see Incidents below).
- `server/src/rateLimit.js` — per-user in-memory rate limiter, two separate instances
  (`generationLimiter`, `chatLimiter`) so a few chat messages don't eat the same budget as
  a full deck generation. Exempt emails via `RATE_LIMIT_EXEMPT_EMAILS` env var (comma-sep,
  never hardcode emails — this is a public repo).
- `server/src/auth.js` — Supabase JWT verification; **auto-disables itself** (treats every
  request as authorized) if `SUPABASE_URL`/`SUPABASE_ANON_KEY` aren't set, so local dev
  works without Supabase configured. Don't "fix" this into a hard requirement.

## Key files (frontend)

- `client/src/pages/Dashboard.jsx` — the authenticated app's root. Owns `activeView` (which
  sidebar section) and `studyingDeck`/`quizzingDeck` (which overlay content, if any).
  **Important**: `handleStudy`/`handleQuiz` in this file both set `activeView` AND open the
  respective overlay — always route through these, not raw `setStudyingDeck`, so the
  sidebar highlight stays in sync with what's on screen.
- `client/src/components/AppShell.jsx` — persistent left sidebar (Home/Decks/Flashcards/
  Questions/Settings), present across every view including while studying/quizzing.
- `client/src/pages/HomeView.jsx` — greeting, quick actions, `StatsSummary`, `ChatPanel`.
- `client/src/lib/db.js` — **dual storage**: Supabase Postgres when signed in, IndexedDB
  for guest mode (no account). Same function signatures either way
  (`loadDecks`/`upsertDeck`/`deleteDeck`/`loadQuizState`/`saveQuizState`/`loadAllQuizStates`)
  so callers never branch on auth state themselves. Uses `getSession()` not `getUser()` for
  the current user id — the latter hits Supabase's auth server over the network on every
  single call, which was a real, measurable source of UI lag.
- `client/src/lib/quizEngine.js` — pure functions, no side effects. Each topic gets exactly
  3 questions (ascending difficulty); a wrong answer cycles to a different one of the 3
  (never repeats the missed question) until all 3 are answered correctly = topic mastered.
- `client/src/components/ErrorBoundary.jsx` — wraps StudyView/QuizView in Dashboard. Added
  after the crash incident below; don't remove it.

## Incidents worth knowing about (so history doesn't repeat)

1. **Remote DoS via malformed input** — `(card.topic || '').trim()` in the old
   `groupCardsByTopic()` threw when `topic` was an object/array (which a weaker fallback
   LLM occasionally produced), and that throw was outside any try/catch → unhandled
   rejection → Node killed the whole process. One crafted request took the backend down
   for every user. Fixed with input coercion + try/catch + process-level
   `unhandledRejection`/`uncaughtException` handlers in `index.js`. If you touch
   `groupCardsByTopic` or `sanitizeQuestions`, re-verify this can't regress — a security
   pass specifically confirmed the fix live in production by replaying the exact crash
   payload.
2. **Supabase statement timeout on big decks** — image-heavy decks (lots of PNG slide
   images in one JSONB `cards` column) exceeded the `authenticated` role's 8s
   `statement_timeout`. Fixed via the PNG/JPEG picker in `pdf.js` + raised the role's
   timeout to 30s via the Supabase Management API. If decks get much bigger than they are
   now, the real fix is moving images to Supabase Storage instead of inline JSONB.
3. **CORS was wide open** (`cors()` with no options = `Access-Control-Allow-Origin: *`)
   until a security pass caught it. Now locked to an `ALLOWED_ORIGINS` allowlist.
4. **Multiple env var typos** cost a lot of back-and-forth — a one-character typo in the
   Supabase project ref (`kzi` vs `kzk`) on both Vercel and Render independently, entered
   by hand each time. If something that was definitely configured "still doesn't work",
   suspect a typo before suspecting the code — verify by decoding the JWT's own `ref` claim
   and diff-checking byte-for-byte against what's actually deployed.
5. **Gemini model deprecation churn** — `gemini-2.0-flash` and `gemini-2.5-flash` both
   went from "working" to "no longer available to new users" mid-conversation. Don't trust
   a hardcoded model name from memory; if generation starts failing, probe
   `/v1beta/models` first.
6. **Statement timeout kept recurring after incident #2's fix** (2026-08-23) — got a fresh
   Supabase Management API token mid-investigation and confirmed the `authenticated` role's
   `statement_timeout` was still the 30s set in incident #2 (did NOT revert). Querying real
   deck sizes (`pg_column_size(cards)`) found the actual causes:
   - Nothing capped LLM output length or validated parsed card fields, so a
     verbose/malformed response (more likely from a weaker fallback model deep in the
     chain) could balloon a deck's save payload. Fixed with `maxOutputTokens`/`max_tokens`
     caps on both providers (`server/src/providers/gemini.js`, `groq.js`) and a
     `sanitizeCards()` step in `server/src/llm.js` (mirrors `sanitizeQuestions`/`asText` in
     `quiz.js`) that truncates every field and drops malformed cards before saving.
   - **The big one**: every card generated from a slide was storing its own full copy of
     that slide's base64 image — a slide yielding 3 cards stored the same ~100KB+ image 3
     times. One real deck (`F1_DS_Protein_Processing`) hit **29.5MB** in the `cards` column
     this way. Fixed in `UploadPanel.jsx`/`StudyView.jsx`: only the first card per page
     keeps the image now, others look it up from a sibling sharing the same `page`.
   - **Still-open, needs the user's decision, not fixed**: `StudyView.handleAnswer` calls
     `onUpdateDeck({...deck, cards})` on *every single flashcard flip*, which re-upserts the
     ENTIRE deck — full cards array, full images — just to persist one card's Leitner box/
     nextReview. For an image-heavy deck this means a multi-MB write on every flip during a
     study session, which is almost certainly the dominant real-world trigger (far more
     write volume than initial deck creation). The proper fix is moving progress
     (box/nextReview) to its own small column (or table) so a flip only writes a few bytes,
     not the whole deck — but that requires `ALTER TABLE decks ADD COLUMN progress jsonb`,
     which is a schema change and got blocked by a safety classifier when attempted
     autonomously. **Ask the user before doing this** — it's a legitimate, low-risk additive
     migration, but production schema changes need a human's go-ahead, not just an
     available token.
   - **Also still-open**: existing decks already saved before the image-dedup fix (the
     20-30MB ones above) still have the duplicated images sitting in Postgres. A one-time
     backfill (strip duplicate per-card images, keep first-per-page) would shrink them
     ~2-3x, but that's a bulk data mutation on production rows — didn't do it without
     asking. If asked to, the query is: for each deck, walk `cards` in array order and null
     out `image` on any card whose `page` was already seen.
   - The Management API token used for this investigation was pasted directly in chat —
     per incident notes above, treat it as exposed; recommend the user rotate it.
   - **The actual smoking gun for "this specific small DOCX keeps failing"**: both
     `upsertDeckRemote` and `deleteDeckRemote` in `db.js` re-fetched the ENTIRE deck list
     (every deck's `cards` column, images included) after every single write, just to hand
     the UI an updated array — so saving a tiny 18KB deck could still fail if ANY other deck
     in the account was large enough to blow the reload past the statement timeout. Fixed
     by not reloading at all — the caller already has the deck it just saved (or the id it
     just deleted); `Dashboard.jsx` now merges into local state directly. **Still open**:
     the initial `loadDecks()` call on page mount has the identical shape of problem (selects
     `cards` for every deck) and can still 500/timeout on mount if the account's decks are
     collectively large enough — saw this happen in a live console check during this
     investigation. The real fix is not fetching full `cards` for the list view at all
     (separate lightweight list query + fetch cards only when a deck is opened), which
     doesn't need a schema change, just touches `DecksView`/`FlashcardsView`/`QuestionsView`/
     `DeckList` (they all read `deck.cards.length` and due-counts directly) — worth doing
     next if initial-load failures keep showing up.
   - **Confirmed happening in production, multiple accounts** (2026-08-23, same day):
     user reported "sign out and back in, decks are gone." Checked `public.decks` directly
     — data was never lost (rows all present, correctly scoped by `user_id`), so this was
     always the initial-load fetch failing silently: `Dashboard.jsx`'s mount effect had no
     `.catch()`, so a failed/timed-out `loadDecks()` just left the `decks` state at its
     empty initial value — indistinguishable from "no decks" in the UI. Two accounts each
     have double-digit-MB total deck size (49MB across 3 decks, 71MB across 11), which is
     genuinely a lot to pull through PostgREST on every single sign-in. Shipped an interim
     fix: retry-with-backoff on `loadDecksRemote` (same pattern as the write-path retry)
     plus a visible error banner + Retry button in `Dashboard.jsx` instead of silently
     rendering empty. **This is a mitigation, not the fix** — the real fix is still the
     lightweight-list-query refactor described above; asked the user whether to do it next.

## Auth / accounts

- Two real user emails are rate-limit-exempt (`RATE_LIMIT_EXEMPT_EMAILS` on Render) — the
  user's own account and a family member's.
- Email confirmation is currently **disabled** (`mailer_autoconfirm: true` in Supabase) as a
  deliberate stopgap — the user hasn't set up a custom domain yet, and Brevo (their SMTP
  provider) can't reliably send "from" a gmail.com address due to Gmail's DMARC policy
  (`p=reject`). Re-enable once they have a domain with proper SPF/DKIM, and swap the SMTP
  sender email off gmail.com at the same time.
- Supabase SMTP is configured (Brevo, `smtp-relay.brevo.com:465`), with MedFlash-branded
  email templates already pushed via the Management API.
- **A Supabase Personal Access Token was pasted in chat during this project and used
  directly via the Management API for schema changes, SMTP config, email templates, and
  the timeout fix.** It should be treated as compromised/logged — if it's still active,
  recommend the user rotate it. Never ask the user to paste another one in chat; if
  Supabase Management API access is needed again, that's worth flagging explicitly rather
  than assuming the old token still works or is still appropriate to use.

## Known gaps / things the user may ask for next

- `medflash.pro`/`www.medflash.pro` are already in `render.yaml`'s `ALLOWED_ORIGINS` — the
  custom domain is live now (this note is newer than the "no custom domain yet" line that
  used to be here; email deliverability off gmail.com is still the open item, see Auth
  section).
- Decks store slide images inline in Postgres JSONB — fine at current scale, would need
  Supabase Storage if decks get much bigger.
- The "Decks" page has a placeholder panel ("More coming here") — the user said they want
  to add more deck-management tools there later but didn't specify what.
- PPTX/DOCX uploads never get slide images (no image-based flashcards for those formats,
  text-only) — only PDF gets vision-based cards, since there's no lightweight way to
  render PPTX/DOCX to images without a heavy dependency (LibreOffice, etc.).
- No automated tests exist anywhere in this repo — every verification in this project was
  done manually (curl against live endpoints, browser automation, or local dev servers).
  If asked to "make sure nothing broke," that means actually running/testing it, not
  assuming from a code read.

## Questions/quiz feature batch (2026-08-23)

Added five features to `QuizView.jsx` in one pass, requested together:

- **Shuffle vs. slide order**: a "setup" phase (new `phase === 'setup'` step, shown before
  generation starts when there's no saved quiz state for the deck) lets the user pick slide
  order vs. shuffled topic order, and easy vs. hard difficulty, before hitting "Start quiz".
  Preference persists in `localStorage` (`medflash:quizPrefs`). `initQuizState(topics,
  {shuffle})` in `quizEngine.js` shuffles `state.order`; `addTopicToState` (see below)
  respects it for topics that arrive later.
- **Background generation**: `QuizView.generate()` no longer waits for every topic's SSE
  event before letting the user start — as soon as the FIRST topic arrives, it builds quiz
  state from what's collected so far and flips to `phase: 'ready'`. Remaining topics keep
  streaming in and get folded into the live state via `addTopicToState()` (new export in
  `quizEngine.js`), including reviving the session out of `'complete'` if the user finishes
  everything currently loaded before more arrives. Uses a `phaseRef` (not the `phase` state
  directly) inside the SSE callback to avoid stale-closure bugs — the callback lives for the
  whole `generate()` call, so plain `phase` from render-time state would be stale.
- **Sidebar minimizer**: `.quiz-sidebar` has a `sidebarMinimized` toggle that collapses it to
  a 56px icon rail (just correct/wrong counts), independent of the existing per-section
  −/+ collapse toggles (which already existed for Flashcards/Questions individually).
- **Locked-in mode**: full-screen (`requestFullscreen()`) timed session (30/60/90 min) with a
  countdown bar and password-gated early exit. Exit password is the literal string
  `ABCDEFGHIJKLMNOPQRSTUVWXYZ1324`, hardcoded in `QuizView.jsx` as
  `LOCKED_IN_EXIT_PASSWORD` — client-side only, not a real security boundary, just friction
  against casually bailing on a focus session. Natural timer expiry exits without the
  password. Deliberately does NOT intercept browser back/Esc/nav-sidebar clicks — scoped to
  just the quiz's own exit button, since trapping a user against the browser itself would be
  a bad idea for what's explicitly a self-imposed focus tool, not a real lockout.
- **Easy/hard difficulty**: `buildQuizPrompt(topicName, cards, difficulty)` in
  `server/src/quiz.js` now branches its style section — easy asks for direct vocab/definition/
  recall questions (no clinical vignettes), hard is the original 2nd/3rd-order clinical-vignette
  prompt. Threaded through `/api/generate-quiz`'s body (`{ cards, difficulty }`) and
  `generateQuizStream(cards, difficulty, onEvent)` in `quizApi.js`. Verified both branches
  live against Gemini — easy produces recall questions, hard produces vignettes, as intended.
- **Verification note**: quiz engine logic (shuffle, background topic merge, revival from
  'complete') was verified with a standalone Node script exercising the real
  `quizEngine.js` functions directly — not through the browser, since `QuizView` only
  renders inside the authenticated Dashboard and no test login was available this session.
  The setup screen, sidebar minimizer, and locked-in mode UI have NOT been visually verified
  live — worth a look next time someone's signed in.

## Design system (2026-08-23)

- Installed the official Anthropic `frontend-design` skill locally at
  `.claude/skills/frontend-design/SKILL.md` (gitignored — `.claude` isn't committed, so this
  is machine-local; re-add it on a fresh clone if wanted). Combines the
  [frontend-design plugin](https://github.com/anthropics/claude-code/tree/main/plugins/frontend-design)
  skill text with the checklist from the
  [Frontend Aesthetics cookbook](https://github.com/anthropics/claude-cookbooks/blob/main/coding/prompting_for_frontend_aesthetics.ipynb).
- Applied it as a token-level redesign (not a component rewrite): new palette + type system
  in `client/src/index.css`, cascading through `App.css`/`Landing.css` via existing
  `var(--...)` usage (only a handful of hardcoded hex values needed manual updates).
  Direction: "chart & specimen" — a clinical study-atlas feel (sage-tinted paper, deep
  teal accent, Fraunces display serif + Source Sans 3 body + IBM Plex Mono for
  eyebrows/data) grounded in the subject (med-student flashcards/anatomy), deliberately
  avoiding the cream/terracotta, near-black/acid-green, and broadsheet defaults the
  cookbook calls out as the current AI-design clichés.
- Logo mark (`.brand-mark`) changed from a 4-dot grid to a folded-corner "index card" glyph
  — updated in `AppShell.jsx`, `AuthPage.jsx`, and `LandingPage.jsx` (all three had the same
  markup).
- Added a signature motion moment: `.stagger-in` in `index.css` (staggered fade-up on
  direct children, respects `prefers-reduced-motion`), applied to `.app-shell-content` in
  `AppShell.jsx`.
- Verified visually via local dev server (landing page + `/login`) with the browser tool.
  **Not yet checked**: the actual signed-in dashboard/study/quiz views, since that needs a
  real login and no test credentials were available this session — worth a once-over next
  time someone's signed in, in case a hardcoded color was missed.

## Stripe billing (2026-08-25) — PICK UP HERE NEXT SESSION

Built real Stripe Checkout + Customer Portal + webhook-driven subscriptions, in **test
mode**, not yet live. Business shape: Free (3 decks, 10 AI generations/mo, 20 chat
messages/mo) + **MedFlash Pro** ($9/mo or $79/yr, one product, two prices, no trial).
**Code is done, builds/boots clean, and is committed + pushed** (`852bf0d`) — Render will
auto-deploy it. All secrets are already in local `server/.env`. What's left is entirely
non-code — do these in order:

1. **Add 6 env vars to Render** (backend service → Environment tab) — not yet confirmed
   done as of this handoff, ask the user to confirm or just check `/api/health`:
   | Key | Value |
   |---|---|
   | `STRIPE_SECRET_KEY` | same value as local `server/.env` (a `rk_test_...` key — don't ask the user to paste it again, it's already in the local file) |
   | `STRIPE_WEBHOOK_SECRET` | same value as local `server/.env` (`whsec_...`) |
   | `SUPABASE_SERVICE_ROLE_KEY` | same value as local `server/.env` |
   | `STRIPE_PRICE_MONTHLY` | `price_1U8obP2fLr3ZKVo7kcbxdjfJ` |
   | `STRIPE_PRICE_ANNUAL` | `price_1U8oba2fLr3ZKVo7oLB46Mlo` |
   | `FRONTEND_URL` | `https://medflash.pro` |
2. Confirm it landed: `curl https://medflashcards.onrender.com/api/health` should show
   `billingConfigured: true` (currently `false`). If still `false` after Render redeploys,
   one of the 6 vars is missing/misnamed — check spelling before anything else.
3. **Run `supabase/billing.sql`** once in the Supabase SQL Editor (Project → SQL Editor →
   New query → paste the whole file → Run) — NOT done yet. Deck creation for a real
   account will error without this, since the code assumes `subscriptions`/
   `usage_counters` already exist. Deliberately done via the SQL Editor, not the
   Management API, per the token-exposure incident above.
4. **Test end-to-end** with Stripe's `4242 4242 4242 4242` test card: sign in on
   `medflash.pro` → Settings → Upgrade → complete Checkout → confirm you land back on
   `/dashboard?view=settings` with a success banner → confirm a row appeared in
   `public.subscriptions` for that user → confirm the Customer Portal button works and
   shows the active subscription. This full round trip has NOT been verified yet.
5. Only after step 4 passes: consider rotating the 3 secrets above, since all three were
   pasted directly into chat during setup (both the restricted key and the webhook secret
   and the service-role key) — see the token-exposure policy elsewhere in this doc. Not
   urgent since they're test-mode keys, but before going live, generate fresh live-mode
   equivalents from scratch rather than reusing/promoting these.

**Gotcha hit while wiring this up, in case it recurs**: the Stripe org has (at least) two
test-mode accounts — plain "MedFlash" (`acct_1U8WVYKDNhGfqUBb`) and "MedFlash sandbox"
(`acct_1U8WVi2fLr3ZKVo7`). The restricted API key and the webhook endpoint were created
under **sandbox**, but the original Product/Prices had been created under the other
account. A Stripe API key only sees objects in its own account, so checkout would have
failed with "No such price" despite everything *looking* configured correctly. Fixed by
recreating the "MedFlash Pro" product (`prod_V96oi61NXNRi5y`) + both prices in the
sandbox account to match where the key and webhook actually live, rather than recreating
the key. **If touching billing again, verify the key's account, the webhook's account,
and the Price IDs' account all agree** —
`list_available_accounts_or_orgs` plus checking each object's account via
`stripe_api_read`/`stripe_api_search` (e.g. `GetWebhookEndpoints`) is how this was caught.
The Stripe MCP tools (`mcp__stripe__*`) need a fresh `/mcp` auth + new session to become
available — they don't appear in a session that was already running when Stripe was
connected.

Until steps 1–3 above are done, `/api/health` reports `billingConfigured: false` and
every `/api/billing/*` route 503s — the rest of the app (deck generation, quiz, chat) is
completely unaffected, since `planLimit.js`'s middleware no-ops whenever
`adminConfigured` is false.

**Architecture notes for anyone touching this next:**
- Deck-count cap (3 free) is enforced by a Postgres trigger, NOT the Express backend —
  deck writes go straight from `client/src/lib/db.js` to Supabase, bypassing the server
  entirely. The trigger has a specific gotcha fix: it short-circuits on
  `exists(select 1 from decks where id = new.id)` before counting, because Postgres fires
  `BEFORE INSERT` triggers on every row of an `upsert()` (including ones that end up being
  updates) *before* conflict resolution — without that check, a user at the cap would get
  incorrectly blocked from studying/editing a deck they already own, not just from
  creating new ones.
- AI-generation/chat caps (`server/src/planLimit.js`) are a separate, new layer from
  `server/src/rateLimit.js`'s existing hourly/daily abuse-prevention limiter — that one is
  unchanged and still runs first on the same routes. Plan-limit checks **fail open** on any
  error (Supabase hiccup, etc.) — consistent with this app's existing tolerance for soft
  failures (e.g. `auth.js` disabling itself when unconfigured) — so a billing outage
  degrades to "unlimited for everyone," not "generation broken for everyone."
- Webhook → user mapping goes through `metadata.user_id` (set on both the Checkout
  Session's `client_reference_id` and its `subscription_data.metadata`), not a
  customer-ID lookup chain — avoids any event-ordering dependency between
  `checkout.session.completed` and the `customer.subscription.*` events.
- The webhook route (`POST /api/billing/webhook`) is registered in `index.js` *before*
  the global `express.json()` call, with its own `express.raw(...)` — required for Stripe
  signature verification to see the exact original bytes. Don't move it after that line.
- Checkout success/cancel and the Portal's return URL all land on
  `/dashboard?view=settings` — `Dashboard.jsx` reads `?view=settings` on mount to default
  `activeView` there instead of `home`; `SettingsView.jsx` reads and then strips
  `?checkout=success|cancelled` for a one-time banner.
- Live-mode rollout (once test mode is verified end-to-end): create the same Product + 2
  Prices in live mode via the Stripe MCP tools, user creates a live-mode RAK + live-mode
  webhook the same way, swap the 4 Stripe-related Render env vars to live values. No code
  changes needed for the switch.
- Not yet verified live (no test-mode keys were available this session, and the user
  deferred setup to a follow-up): the actual checkout → webhook → subscription-row →
  portal round trip, and the 402/deck-cap error messages actually rendering in the
  browser. Worth a real pass with Stripe's `4242 4242 4242 4242` test card before
  considering this done.

## Working style notes for whoever picks this up

- The user tests almost everything live (Vercel/Render production URLs), not just locally
  — expect "check it now" after every push, and be ready to verify with curl/browser
  automation against the real deployed URLs, not just `npm run build`.
- Local Windows dev quirks: `node --watch` sometimes shows a spurious extra restart right
  after startup — not a real bug, just wait a beat before testing. Vite's dev server can
  get a stale HMR module graph if you rename/move a file while it's running — clear
  `node_modules/.vite` and restart if you see phantom "Failed to reload" errors referencing
  a file that no longer exists.
- Always clean up test users/decks/scratch files created during verification (there's a
  established pattern of creating throwaway `@mailinator.com` test accounts via the
  Supabase Management API, then deleting them + their data afterward). Don't leave test
  clutter in the production database.
- This is a public GitHub repo — never commit secrets, and be deliberate about any new
  npm dependency's security posture (one was swapped out mid-project — `officeparser` for
  `mammoth` + `fflate` — specifically because it pulled in a vulnerable `pdfjs-dist`).
