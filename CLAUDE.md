# resumebench

A personal, single-file resume workbench. One master profile, tailored per job posting by an LLM, rendered to ATS-parseable output.

Built for one user (the repo owner). No accounts, no multi-tenancy, no backend. Do not add any.

---

## Current state

- `resume-bench.html` — the entire application. HTML + CSS + vanilla JS, no build step, no dependencies, no framework.
- `proxy.mjs` — a loopback-only relay that holds the API key. Node 18+, standard library only. The single reason a second file exists.
- Fonts load from Google Fonts with a system fallback stack. Everything else is self-contained.

---

## Running it

```
echo 'GEMINI_API_KEY=...' > .env   # once, key from https://aistudio.google.com/apikey
node proxy.mjs
```

Then open `resume-bench.html` in a browser. The proxy reads `.env` beside itself (`.gitignore`d) via `process.loadEnvFile`, so the key stays out of shell history. **An already-exported `GEMINI_API_KEY` overrides the file** — Node's precedence, not ours — so the proxy prints which source it used and the key's last four characters at startup. A stale exported key silently shadowing `.env` is otherwise invisible.

Runs on Gemini's free tier, so there is no bill and no credit balance to keep topped up. Editing, rendering, printing, and `parserCheck()` all work with the proxy down — only the model actions (import, gaps, bullets, tailor, score) need it, and they say so when it isn't running.

The proxy binds `127.0.0.1:8787`, forwards `POST /v1beta/interactions` upstream with `x-goog-api-key`, passes `Retry-After` back through, and answers the CORS preflight so the page works from `file://`. `PORT` overrides the port; `API_ENDPOINT` in the HTML has to match. **The key lives in the environment and never enters the page — keep it that way.** Never commit it.

The proxy is deliberately dumb — it adds the key header and forwards the body untouched. The page speaks Gemini's request shape directly, so changing provider again means editing `UPSTREAM`/`AUTH_HEADER` in `proxy.mjs` and `ask()`/`readText()` in the HTML, and nothing in between. The rejected alternative was calling the API straight from the browser; fewer moving parts, but it puts the key in the page.

### Storage

`store` (in the HTML) prefers `window.storage` when present — that is the claude.ai artifact host — and falls back to `localStorage` everywhere else, so the file still runs in both places. Keys: `bench:profile`, `bench:jd`. A failed read surfaces in the error banner; a failed write flashes in the header. Neither is swallowed.

---

## Architecture

**One source of truth.** `S.profile` holds everything you have ever done. Every resume is a *projection* of it. The model transforms that object; it never owns it, never writes to it directly, and never persists anything itself.

**Tailoring is a separate layer.** `S.tailored = { bullets: { [roleId]: string[] }, summary }` overlays the master at render time via `activeExperience()` and `activeSummary()`. The master is never mutated by a tailor run. This is the invariant that makes the tool trustworthy — preserve it. If you add a new tailorable field, it goes in the overlay, not the profile.

**ATS-safety lives in the renderer, not the prompt.** `renderPaper()` and the print stylesheet guarantee single column, standard headings, real selectable text. A model that misbehaves cannot produce an unparseable document. Do not move these guarantees into prompt instructions.

**Rendering is full-redraw.** `render()` rebuilds the tools panel from state on every change; delegated listeners live on `#tools`, not on individual elements. Text inputs update state on `input` and call the cheap paths (`renderPaper()` + `parserCheck()`) rather than a full `render()`, because a full redraw would blow away focus mid-typing. Keep that distinction.

### State shape

```js
S = {
  profile: {
    contact: { name, title, email, phone, location, links },
    summary: "",
    experience: [{ id, role, company, start, end, location, bullets }], // bullets: newline-delimited string
    educationRaw: "",   // one per line, fields split by |
    skillsRaw:    "",   // one group per line, "Category: a, b, c"
    projectsRaw:  ""    // one per line, fields split by |
  },
  jd, mode, keywords: [{term, hit}], tailored, showTailored,
  score, variants, questions, busy, error
}
```

Bullets are a newline-delimited string rather than an array on purpose — a textarea is a better editing surface than a list of inputs, and `lines()` splits it wherever an array is needed. Same reasoning for education/skills/projects. Resist normalising these into objects unless a feature genuinely requires it.

Only `experience` entries carry an `id`, because tailoring keys off it.

---

## Model conventions

- `MODEL` is `gemini-3.6-flash`, a constant next to `ask()`. No output-token cap is sent: the field name isn't verified for this endpoint, and per-role chunking already bounds each response.
- `ask(prompt, {json})` posts `{model, input}`. **The answer is in `steps[]`, in entries typed `model_output`** — verified against live responses. Two traps here, both of which cost a debugging round: `output_text` is an *SDK* convenience property and does **not** exist in the REST payload (it stays in `readText()` only as a fallback), and a `thought` step (reasoning, no content) precedes the answer, while `user_input` may echo the prompt. Filtering to `MODEL_STEP_TYPES` is what keeps either from being concatenated onto the answer — take every step and `JSON.parse` fails on the joined string.
- `askJSON()` sets `response_format.mime_type: "application/json"`, so JSON mode does the work. The fence-stripping and first-`{` scan are kept as a belt-and-braces fallback. Every prompt still ends with a shape spec and a JSON-only instruction.
- **Retries are adaptive, not scheduled.** Free-tier limits are per-account and unpublished, so `ask()` retries 429/500/503 up to `MAX_ATTEMPTS`, honouring `Retry-After` when present and doubling `BACKOFF_MS` otherwise, and reports the wait in `S.busy`. Don't replace this with a fixed sleep between calls — the limits aren't knowable up front.
- Google wraps some payloads (its errors, at least) in a single-element array; `unwrap()` handles both shapes. A bad key arrives as **400 `API_KEY_INVALID`**, not 401 — `apiError()` keys off the reason, not the status.
- **`RULES` is prepended to every generative prompt.** It forbids inventing metrics, titles, dates, tools, or outcomes. This is the single most important line in the codebase — a tailored resume the user cannot defend in an interview is worse than an untailored one. Any new prompt includes it.
- **Tailoring is chunked one call per role**, not one call for the whole resume. Originally forced by a 1000-token cap; keep it anyway — it bounds each response, isolates failures to one role, and drives the progress messages in `S.busy`.
- `run(label, fn)` wraps every async action: sets the busy banner, catches, and shows the error. A `SyntaxError` — the model returning unparseable JSON — becomes "run it again" rather than a stack trace; everything else surfaces its own message, so `apiError()` writes those to be read by a person.

---

## Design

Deliberate contrast: the **application** is opinionated, the **document** is deliberately plain, because ATS constraints demand it. Do not let app styling leak into `.paper`.

Tokens (`:root`):

```
--ink #141C25   --ink-2 #4C5C6B   --ink-3 #8A98A5
--mat #D7DEE4   --mat-line #CAD3DA   --panel #F1F5F7   --edge #B4C0CA
--paper #fff    --mark #FFD84D    --gap #BE443A    --ok #2E6B58
--display Space Grotesk   --mono IBM Plex Mono   --doc Georgia
```

The background grid is a drafting mat. The signature element is the **highlighter** (`.hl`): a skewed gradient swipe over keywords matched from the posting, with a red wavy underline for gaps. It's the one loud thing — everything else stays quiet. Highlighting is stripped in print.

---

## Domain rules the renderer enforces

Encoded in `renderPaper()`, the print stylesheet, and `parserCheck()`. Treat as requirements, not preferences.

- Single column. No tables, text boxes, columns, icons, headers, or footers.
- Standard section headings only: Summary, Experience, Projects, Education, Skills.
- Real selectable text. PDF exported from text, never an image.
- Dates as `MM/YYYY`, or `Present`.
- Bullets: one idea, one sentence, past-tense verb first, under ~210 characters.
- Roughly 800 words is the two-page line.

`parserCheck()` runs locally on every keystroke with no API call: missing email/phone, undated roles, over-long bullets, bullets with no number, passive openers (`WEAK` array), missing skills section, word count. Keep it API-free — its value is that it's instant.

---

## Known issues

- `mark()` uses a lookbehind regex with a `\b` fallback in a try/catch, for older Safari. If you touch it, keep the fallback.
- Keyword matching in `S.keywords[].hit` is naive substring on lowercased text. No stemming, so "orchestration" won't match "orchestrate". Fine for now; a stemmer would improve it.
- No undo. A tailor run is reversible (master is intact), but deleting a role is not.
- No validation on the `|`-delimited education/projects lines — malformed input renders oddly rather than erroring.

---

## Roadmap

1. **Version history.** Keep every tailored variant keyed to the company and date sent. This is the highest-value feature — it turns the tool from a generator into a record of what you actually claimed to whom, which matters when the interview call comes eight weeks later.
2. **`.docx` export.** A handful of older ATS systems still parse Word more reliably than PDF. Single-column, styles-based, no content controls.
3. Stemmed keyword matching.
4. Cover letter drafting off the same master profile.

Done: the two artifact-only dependencies (storage, API key) — see **Running it** above.

---

## Working conventions

- Single file, zero dependencies, no build step. Adding a bundler, a framework, or an npm install needs a real reason.
- Prefer plain text state over structured state where a textarea is the better editing surface.
- Every new AI feature: prepend `RULES`, specify the JSON shape in-prompt, wrap in `run()`.
- Copy follows the interface's voice: active verbs, sentence case, errors state what happened and what to do, empty states invite an action. No apologising in UI strings.
- Accessibility floor: visible keyboard focus, `prefers-reduced-motion` respected, responsive to mobile. Already in place — don't regress it.
