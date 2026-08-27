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
     just deleted); `Dashboard.jsx` now merges into local state directly. The initial
     `loadDecks()` call on page mount had the identical shape of problem (selected `cards`
     for every deck) — **fixed 2026-08-24 in commit `d42165b`**: `db.js` now has
     `loadDecksMetaRemote()`, a lightweight query (`id, name, source_file, created_at`, no
     `cards`) that paints the list almost instantly; `loadDecksRemote()` (full `cards`,
     including images) then streams in behind it in the background. `cards: null` is the
     "still loading" sentinel that `FlashcardsView`/`QuestionsView`/`DeckList` read instead
     of blocking on it. No schema change was needed.
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
     rendering empty. **Superseded 2026-08-24** by the `loadDecksMetaRemote()` fast-path
     fix described directly above — the retry/banner mitigation is still in place as a
     fallback, but the metadata-only query means the slow/timeout-prone full fetch no
     longer blocks the initial page paint at all.

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
- ~~No automated tests exist anywhere in this repo~~ — fixed 2026-08-26, see the
  billing/security testing section below. Still true that most verification in this
  project is manual (curl against live endpoints, browser automation, local dev servers)
  — the new test suite covers a handful of high-risk pure functions, not the app broadly.
  If asked to "make sure nothing broke," that still means actually running/testing it.
- **Potential decompression-bomb DoS in PPTX/DOCX upload handling** — found during the
  2026-08-26 security review, not fixed. `server/src/officeDocs.js` calls fflate's
  `unzipSync()` on an uploaded PPTX with no cap on the decompressed size — only the
  *uploaded* file is capped (multer's 40MB `MAX_UPLOAD_BYTES` in `index.js`). A small,
  highly-compressed archive could decompress to far more than 40MB in memory on the
  single-process Render backend, which is exactly the "one bad request takes down the
  whole server for everyone" failure shape this project has been bitten by before (see
  incident #1). Not confirmed exploitable in practice (didn't want to actually construct
  and upload a zip bomb against production without asking first) — flagging as a real gap
  worth closing, likely via checking each zip entry's declared uncompressed size before/
  during extraction and aborting past some threshold, or a streaming unzip with a cap.
  DOCX (via `mammoth`) wasn't checked for the same class of issue and may have it too.

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

## Stripe billing (2026-08-25, verified end-to-end 2026-08-26)

Real Stripe Checkout + Customer Portal + webhook-driven subscriptions, in **test mode**,
not yet live. Business shape: Free (3 decks, 10 AI generations/mo, 20 chat messages/mo) +
**MedFlash Pro** (originally $9/mo or $79/yr, one product, two prices, no trial —
**changed 2026-08-26 to a single $15/mo tier, no annual**, see the dated section further
below). **Fully working and verified live** — steps 1–4 below are done. Only step 5
(rotate test-mode secrets) and live-mode rollout remain, and neither is urgent.

1. ✅ **Render env vars** — all 6 confirmed set on the `MedFlashcards` service
   (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`,
   `STRIPE_PRICE_ANNUAL`, `SUPABASE_SERVICE_ROLE_KEY`, `FRONTEND_URL`). Note: as of
   2026-08-26 `SUPABASE_SERVICE_ROLE_KEY` was actually **missing** on Render despite this
   doc previously saying it was set (`/api/health`'s `billingConfigured` only reflects
   `STRIPE_SECRET_KEY`, not the Supabase key, so it looked "done" but `/api/billing/*`
   was 503ing — logs showed `SUPABASE_SERVICE_ROLE_KEY not set — billing routes will
   respond 503.`). Re-pushed it from local `server/.env`; also re-confirmed
   `STRIPE_PRICE_MONTHLY`/`STRIPE_PRICE_ANNUAL` were missing and pushed those too. **If
   billing ever looks half-configured again, don't trust `/api/health` alone — it only
   checks the Stripe key.**
2. ✅ Confirmed: `curl https://medflashcards.onrender.com/api/health` shows
   `billingConfigured: true`.
3. ✅ `supabase/billing.sql` has been run — `subscriptions`/`usage_counters` tables exist.
4. ✅ **Full round trip verified live** (2026-08-26, throwaway
   `medflash-billing-test-0826@mailinator.com` account, cleaned up afterward): signed in on
   `medflash.pro` → Settings → Upgrade → Stripe Checkout with `4242 4242 4242 4242` →
   landed back on `/dashboard?view=settings` → Settings showed **MedFlash Pro (monthly)**
   with a real renewal date, confirming the webhook wrote the `subscriptions` row → Customer
   Portal (Manage subscription) opened and showed the active sub, card on file, and a paid
   $9.00 invoice → cancelled the test subscription there too (exercises the
   `customer.subscription.updated` webhook path). Hit and fixed one real bug along the way,
   see below.
5. Still open, not urgent (test-mode keys, no real money involved): rotate
   `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`/`SUPABASE_SERVICE_ROLE_KEY` since all three
   were pasted directly into chat during original setup — see the token-exposure policy
   elsewhere in this doc. Before going live, generate fresh live-mode equivalents from
   scratch rather than reusing/promoting these.

**Bug found and fixed during the 2026-08-26 verification pass**: checkout was failing with
a 500 (`Failed to create checkout session: StripeInvalidRequestError: Invalid
line_items[0]: the product tax code is missing`). Cause: Stripe's newer **Managed
Payments** feature is enabled by default on new/sandbox accounts and requires a product
tax code, which this app never set (no Stripe Tax integration anywhere in the codebase).
Fixed in `server/src/billing.js`'s `createCheckoutSession` by passing
`managed_payments: { enabled: false }` on the Checkout Session — opts back out to the
standard Billing + webhook flow the rest of this integration is built around. Committed as
`d90effb`, pushed, deployed, and this is the fix that made step 4 above pass. **If
resurrecting Managed Payments is ever wanted on purpose** (Stripe becomes more involved in
tax remittance), that's a real product/tax decision, not just a config tweak — needs a
product tax code set via the Dashboard or API, not just deleting this line.

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

If billing env vars/SQL are ever incomplete again, `/api/health` reports
`billingConfigured: false` and every `/api/billing/*` route 503s — the rest of the app
(deck generation, quiz, chat) is completely unaffected, since `planLimit.js`'s middleware
no-ops whenever `adminConfigured` is false.

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
- Live-mode rollout (test mode is now fully verified end-to-end, see above — this is the
  next real step): create the same Product + 2 Prices in live mode via the Stripe MCP
  tools **including a product tax code this time** (or explicitly keep
  `managed_payments: { enabled: false }`, which works fine in live mode too), user creates
  a live-mode RAK + live-mode webhook the same way, swap the 4 Stripe-related Render env
  vars to live values. No code changes needed for the switch beyond what's already shipped.
- 402/deck-cap/expiry/security testing: **done, 2026-08-26** — see the dated section
  directly below for the full pass (limits, expiry lifecycle, cancellation display, and a
  security review that found one real vulnerability).

## Billing/security deep-testing pass (2026-08-26)

Ran a full pass at the user's request: plan limits, subscription expiry/renewal, the
Customer Portal cancellation flow, annual billing, a Home-dashboard plan indicator, and a
security review. Used several throwaway `@mailinator.com` test accounts (all deleted
afterward) plus direct service-role queries against the same production Supabase project
(local dev server points at prod DB — see `server/.env`). **One fix is prepared but NOT
yet live** (the security one — see "One migration pending" below); a second fix was
shipped, caused a real incident, and was reverted — see "The 'Renews after cancel' fix"
below before touching that area again.

**What was tested and confirmed working, live, with real code (no mocks unless noted):**
- Free-plan limits — deck cap (3), AI generations (10/mo), chat messages (20/mo) all
  correctly block at the limit, both at the API level (402 with a clear message,
  Postgres trigger with a clear message for decks) and visibly in the browser UI (the
  friendly message renders, not a raw error). Editing/studying an already-owned deck at
  the cap still works (the specific gotcha fix in `enforce_deck_limit` holds).
- Subscription expiry — seeded a user into an active Pro state, then invoked the real
  `handleWebhookEvent()` (server/src/billing.js) with a realistic
  `customer.subscription.deleted` payload (what Stripe actually sends when a canceled
  subscription's period genuinely ends). Confirmed the user was correctly downgraded to
  Free and all three usage limits re-applied immediately.
- Annual billing (`$79/yr`) — a real live checkout end-to-end, confirmed Settings shows
  "MedFlash Pro (annual)" with the correct renewal date a year out (not just monthly,
  which is all that had been tested before this).
- Successful renewal and a declined recurring charge (`past_due`) — added as permanent
  mocked tests (`server/src/billing.webhook.test.js`, uses a fake Supabase client via
  `node --experimental-test-module-mocks`, touches no real data) after a live
  `node -e` script poking real subscription rows to test this got correctly blocked by
  the coding agent's own safety guardrails. Confirms `handleWebhookEvent` writes the
  rolled-forward `current_period_end`/`plan` on renewal, and writes `status: 'past_due'`
  (not `active`) on a declined charge — `isUserPro`/`getBillingStatus` both gate Pro
  access on `status === 'active' || 'trialing'`, so `past_due` correctly falls through to
  Free. Real Stripe Test Clocks (which would exercise actual Stripe-side webhook delivery
  too, not just our handler) were NOT usable for this — our restricted API key lacks the
  `billing_clock_write` permission, and that can only be granted from the Stripe
  Dashboard UI (no API for it), not something to do without the user doing it themselves:
  https://dashboard.stripe.com/b/acct_1U8WVi2fLr3ZKVo7?destination=%2Ftest%2Fapikeys%2Fmk_1U8XJT2fLr3ZKVo7vipt46P6%2Fedit
- Declined card (`4000000000000002`) — Stripe Checkout shows its own inline decline
  message and lets the user retry, no crash; confirmed no subscription/Pro access was
  granted for that attempt (`status: 'none'` in the DB afterward).
- Auth enforcement — every protected endpoint (`/api/billing/*`, `/api/chat`,
  `/api/generate-quiz`) correctly 401s with no token or a garbage token.
- RLS isolation — a signed-in user cannot read another user's `decks`/`subscriptions`/
  `usage_counters` rows even with an unfiltered `select=*` or an explicit filter for
  someone else's `user_id`; cannot self-grant Pro via a direct `PATCH` on their own
  `subscriptions` row (no `update` RLS policy exists, exactly as documented in
  `billing.sql`); cannot insert a `decks` row under someone else's `user_id` (blocked by
  RLS with a clear `42501` error).
- Webhook signature verification correctly rejects a forged/unsigned POST (`400 Invalid
  signature`) — tested against local (same code/secret as prod, avoided POSTing
  fabricated payloads at the real production endpoint).
- CORS — a disallowed origin gets no `Access-Control-Allow-Origin` header at all;
  `https://medflash.pro` gets the header echoed back specifically, never a wildcard.
- No `dangerouslySetInnerHTML`/`innerHTML=` anywhere in the client — flashcard/quiz/chat
  content (ultimately LLM output over user-uploaded documents, so not fully trusted) is
  always rendered through React's auto-escaping, no stored-XSS surface.
- Client bundle (`client/dist/assets/*.js`) has no leaked secrets — only the public
  Supabase anon key and URL, as expected.
- Rate limiter (`server/src/rateLimit.js`) keys correctly on the authenticated user id
  (not spoofable), has a periodic cleanup so the in-memory map can't grow unbounded.

**Fixed and shipped already (pushed, live):**
- Dashboard now shows a "Free plan" / "MedFlash Pro" badge in the Home greeting panel
  (`client/src/pages/HomeView.jsx`'s `PlanBadge`), not just Settings — click it to jump to
  Settings. Silently hides in guest mode or if billing status fails to load, rather than
  showing an error on the home page.
- `server/`, `client/` both now have a real (if minimal) test suite —
  `node --test src/**/*.test.js` via `npm test` in each — covering the exact functions
  behind two past production incidents (`groupCardsByTopic`/`sanitizeQuestions`/
  `sanitizeCards`, the crash-payload and malformed-LLM-output classes of bug) plus the
  quiz engine's retry/mastery state machine. Zero new dependencies (Node's built-in
  runner). 40 tests, all passing as of this commit.

**One migration pending — run this in the Supabase SQL Editor:**

**`supabase/security_fix_increment_usage.sql` — run this, it's urgent.** Found a
   real, confirmed-exploitable vulnerability: `public.increment_usage` (the RPC that backs
   the free-plan generation/chat counters) is `security definer` with no check that the
   caller owns `p_user_id`. Any signed-in user can call it directly
   (`POST /rest/v1/rpc/increment_usage`) with an **arbitrary** `p_user_id` — confirmed live
   by using one throwaway test account's own JWT to drive a second throwaway account's
   `chat_count` from 0 straight to its monthly limit, silently locking it out. This is a
   real denial-of-service surface against any user's free-tier quota. The fix is a pure
   permissions change (`revoke execute ... from authenticated, anon`) — no application code
   changes needed, and the server's own legitimate calls (via the service-role client)
   are completely unaffected, since service_role bypasses function grants entirely. The
   same file also hardens `enforce_deck_limit()` (the deck-cap trigger) against a related,
   much lower-severity issue: it runs *before* RLS validates the insert, so it currently
   leaks a tiny amount of information about an arbitrary `user_id` (whether they have 3+
   decks and aren't Pro) via which of two error messages comes back, even though the
   actual write stays correctly blocked by RLS either way. See the file's comments for the
   full writeup. **Also worth knowing**: while confirming this bug was real (and not just
   an RLS-scoping false-positive from a throwaway account), a real production account —
   `aadyajain822@gmail.com`, one of the two rate-limit-exempt family accounts — had its
   `chat_count` nudged 0 → 1 for this month. Reverting that single-count touch was
   correctly blocked by the coding agent's own safety guardrails (a direct write to a real
   user's data), so it was left as-is rather than forced through — impact is negligible (1
   of a 20/month limit, self-corrects next month, irrelevant if that account is ever Pro)
   but flagging it for visibility.

**The "Renews after cancel" fix — reverted, needs to be redone properly. Read this before
touching it again.** The original fix (webhook write + `getBillingStatus` + Settings
copy) was committed locally as `dd7387b`, deliberately *not* pushed, with a migration
file (`supabase/billing_cancel_at_period_end.sql`) waiting for the user to run first —
same pattern as the security fix above, and it should have been safe.

**It wasn't.** A few minutes later, an unrelated commit (`02f816b`, just a HANDOFF.md
update + the security-fix SQL file) got pushed with a plain `git push origin main` —
which pushes the *entire* local branch history, not just the files staged in that commit.
`dd7387b` was still sitting locally ahead of `origin/main`, so it went out too, silently.
Render deployed it immediately. Every subsequent `customer.subscription.created/updated`
webhook then failed its DB write atomically (`Could not find the 'cancel_at_period_end'
column`) — swallowed internally, so Stripe got a 200 and never retried — meaning
`status`/`plan`/`current_period_end` all silently stopped updating for **every**
subscription event, not just the cosmetic field. Caught within the same session (a real
annual checkout completed on Stripe's side but showed "Free plan" in the app) and fixed
by immediately reverting (`41572d8`, pushed) rather than rushing the migration through,
since reverting doesn't depend on anyone's timing. Confirmed working again with a second,
clean annual checkout afterward.

**The actual lesson, not just this one bug**: `git push` sends the whole branch, so
"commit locally, don't push, wait for a prerequisite" is not a safe pattern the moment
*any* other commit needs to go out before the prerequisite is met — the safe version is
either a separate branch/PR, or genuinely not writing the schema-dependent code at all
until the migration is confirmed applied.

**To redo this fix properly**: once `cancel_at_period_end boolean not null default false`
exists on `public.subscriptions` (recreate the migration — it was a one-line `alter table
... add column if not exists`, deleted along with the revert), re-add: the webhook write
in `upsertFromSubscription` (`server/src/billing.js`), the field in `getBillingStatus`'s
return value, and the conditional copy in `SettingsView.jsx`'s `PlanPanel` ("Cancels
`<date>` — you'll keep Pro access until then" vs "Renews `<date>`"). Verify the column
exists (e.g. a throwaway `select cancel_at_period_end from subscriptions limit 1`) in the
same session as writing the code, immediately before pushing — don't trust an earlier
`AskUserQuestion`-style confirmation from a different point in the conversation.

## Pricing changed to $15/mo flat, annual tier dropped (2026-08-26)

User's call, after discussing comparables (Quizlet Plus ~$8/mo, Osmosis/Picmonic
~$15-20/mo, AMBOSS/UWorld ~$35-50/mo but those sell proprietary content, MedFlash doesn't)
— $9/mo undervalued the product, and the $79/yr tier added UI/code complexity
(interval selection, two price IDs) for a tier nobody had actually subscribed to yet.

- Old test-mode prices (`price_1U8obP2fLr3ZKVo7kcbxdjfJ` $9/mo, `price_1U8oba2fLr3ZKVo7oLB46Mlo`
  $79/yr) deactivated in Stripe, not deleted — Stripe prices are immutable/undeletable by
  design, only deactivatable. New price: `price_1U8rf92fLr3ZKVo7SNYdfHoS`, $15/mo, same
  product (`prod_V96oi61NXNRi5y`). `STRIPE_PRICE_MONTHLY` updated on both Render and local
  `server/.env`; `STRIPE_PRICE_ANNUAL` is no longer read anywhere in code (left unset,
  harmless either way).
- Removed all interval/annual plumbing: `createCheckoutSession` (`server/src/billing.js`)
  and the `/api/billing/checkout` route no longer take an `interval` param;
  `startCheckout()` (`client/src/lib/billingApi.js`) takes no args; `SettingsView.jsx`'s
  `PlanPanel` shows a single "$15/month" line instead of a monthly/annual radio pair;
  `LandingPage.jsx`'s pricing section lost its Monthly/Annual toggle. If a second tier is
  wanted later, re-adding an `interval`-style param (or a proper multi-tier price map,
  since a hardcoded single `STRIPE_PRICE_MONTHLY` env var doesn't generalize past one
  paid tier) is a bigger change than just flipping a price ID.
- Verified live end-to-end with a real test-mode checkout at the new price
  ($15.00/month shown correctly in Stripe Checkout, correct amount charged, Settings
  correctly shows Pro with no stale "(annual)"/"(monthly)" qualifier since there's only
  one plan now).
- **Raising this price later**: create a new Price (Stripe prices can't be edited), point
  new checkouts at it — existing subscribers automatically keep paying their original
  price unless you deliberately migrate them (Stripe's default, not something to build).
- **Incident during cleanup, worth knowing about**: while canceling leftover test
  subscriptions from this session's testing (Stripe's search API doesn't filter by
  metadata/email at a glance, so it was easy to assume a batch of "active" test-mode
  subscriptions were all throwaway test accounts), one of them turned out to belong to
  the user's **own real account** (`aajainlast@gmail.com`) — a test-mode subscription
  that had already been cancel-requested (status still `active`, cancellation already
  scheduled for its period end) got canceled immediately instead of at period end. Test
  mode, so zero real financial impact either way, and it was already on a path to
  cancellation — but it wasn't verified as test data before being touched, which was the
  actual mistake (two other subscriptions in the same batch WERE verified by customer
  email before canceling; this one should have been too, and wasn't, until after the
  fact). **Lesson**: always resolve a Stripe object's owning customer/email before any
  bulk cleanup action, even in test mode, even when "probably all test data" seems safe
  to assume from timestamps/patterns alone.

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
