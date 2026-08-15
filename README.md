# MedFlash

Turn medical lecture PDFs into study flashcards, slide by slide.

## Structure

- `client/` — React (Vite) frontend: upload PDFs, review decks, study with a Leitner spaced-repetition flow, export to Anki. Decks (including slide images) persist in the browser's IndexedDB.
- `server/` — Express backend: walks the PDF one slide at a time, extracting text and rendering a PNG of that slide, then asks an LLM (Gemini or a local Ollama vision model — your choice) to turn each slide into a set of consolidated, clearly-explained flashcards, streamed back to the client as they're ready.

## Setup

### 1. Backend

```bash
cd server
npm install
cp .env.example .env   # already done — just edit .env
```

Choose an LLM backend in `server/.env` by setting `LLM_PROVIDER` to `gemini` or `ollama`:

**Option A — Gemini (free API key, no install)**

```
LLM_PROVIDER=gemini
GEMINI_API_KEY=...
```

Get a free key from [Google AI Studio](https://aistudio.google.com/apikey). Gemini models come and go — if you hit a "model not available" or quota error, check `GEMINI_MODEL` against the models listed at `GET https://generativelanguage.googleapis.com/v1beta/models?key=YOUR_KEY`; `gemini-flash-lite-latest` (the default) tends to have the most generous free-tier quota.

**Option B — Ollama (fully local, no key, no internet needed after setup)**

```
LLM_PROVIDER=ollama
OLLAMA_MODEL=llama3.2-vision
```

Install [Ollama](https://ollama.com), then pull a vision-capable model (needed to read diagram-heavy slides) and make sure it's running:

```bash
ollama pull llama3.2-vision
ollama serve
```

Run the backend:

```bash
npm run dev
```

Server starts on `http://localhost:8787`.

### 2. Frontend

```bash
cd client
npm install
npm run dev
```

Opens on `http://localhost:5173`.

## Usage

1. Upload a lecture slide deck (PDF).
2. Click **Generate flashcards** — the server goes slide by slide, sending each slide's text and image to the LLM and asking it to consolidate that slide's material into a small number of clearly-explained cards (with a table when the content is naturally tabular, and a memory trick when one fits naturally) rather than one card per bullet point. A progress bar tracks slides processed / cards found, and any slide that fails (e.g. a transient rate limit) is called out by number afterward.
3. Study with the flip-card UI, in slide order. Each card's back shows the plain-language explanation, any table, and any mnemonic; an expandable "View source slide" section shows the original slide image so you can see diagrams that don't come through in text. Cards you know move to a higher Leitner box (reviewed less often); cards you miss reset and come back sooner.
4. Click **Export to Anki** on a deck to download a ready-to-import `.apkg` file — double-click it (or drag into Anki) and the deck, cards, tables, mnemonics, and slide images all come in together, in slide order, styled for both light and dark Anki themes.

## Notes / next steps

- Every LLM call (across all concurrent slides) is paced through a shared rate limiter and retries using the provider's own suggested wait time on a 429, so large decks (60-100+ slides) should complete without silently dropping slides — it just takes longer.
- Anki export runs entirely in the browser (via a vendored copy of [genanki-js](https://github.com/krmanik/genanki-js) + sql.js) — no server round-trip, no image re-upload.
- Decks (with embedded slide images) are stored in the browser's IndexedDB — no account system or backend database. Clearing browser storage clears your decks.
- Vision-capable models (Gemini, or an Ollama model with "vision"/"llava" in the name) get the slide image as well as its extracted text, so diagram-heavy slides still generate cards even with little machine-readable text. Non-vision Ollama models fall back to text only.
