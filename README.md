# resumebench

A single-file resume workbench. One master profile, tailored per job posting by an
LLM, rendered to ATS-parseable output. No accounts, no backend, no build step.

## What it does

- **One master profile** — everything you've ever done, in `localStorage`. Every
  resume is a projection of it; tailoring never overwrites the master.
- **Tailor per posting** — paste a job description, get reworded bullets and a
  summary aimed at it, without inventing metrics, titles, or tools you don't have.
- **Version history** — save a tailored resume per company/role, reopen and edit
  any of them later, correct a typo in the master and every saved version picks
  it up.
- **ATS-safety enforced by the renderer, not the prompt** — real headings, real
  lists, real selectable text, single column (with one flagged exception). A live
  score with actionable findings runs on every keystroke, no API call needed.
- **`.docx` import** — read straight out of an uploaded resume, parsed entirely in
  the browser. The file never leaves your machine.
- **Backup/restore** — the whole app state exports to one JSON file. That file is
  the only "backup" there is — there's no server to lose it to.

## Quick start

```
git clone https://github.com/bylukeO/resumebench.git
cd resumebench
echo 'GEMINI_API_KEY=...' > .env   # get a free key: https://aistudio.google.com/apikey
node proxy.mjs
```

Then open `resume-bench.html` in a browser.

## Bring your own key

This is BYOK — there's no shared backend or hosted service. `proxy.mjs` is a
tiny loopback-only relay (`127.0.0.1:8787`, Node 18+, zero dependencies) that
holds your key server-side so it never enters the page. It reads `GEMINI_API_KEY`
from `.env` (see `.env.example`), forwards requests to Gemini, and does nothing
else — no logging, no rewriting, no third-party calls.

Runs on Gemini's free tier: no bill, no credit balance.

Swapping providers means editing `UPSTREAM`/`AUTH_HEADER` in `proxy.mjs` and
`ask()`/`readText()` in `resume-bench.html` — the proxy speaks whatever shape
you point it at.

### Works without a key too

Editing, rendering, printing/exporting to PDF, and the live ATS score all work
with the proxy down. Only the AI-backed actions — import, gap-finding, bullet
rewriting, tailoring, AI scoring — need it, and they say so in the UI when the
proxy isn't running.

## Privacy

- Your resume data lives only in your browser's `localStorage`. Nothing is sent
  anywhere except to Gemini, and only when you trigger an AI action.
- `.docx` uploads are decoded entirely client-side (native `DecompressionStream`,
  no library, no upload) — only the extracted text goes to the model.
- The API key never reaches the page; it lives in `.env` on your machine and is
  attached to requests by the proxy.

## Known limitations

- Uploads support `.docx`, `.txt`, and `.md` — no `.doc` or `.pdf`.
- No stemming in keyword matching ("orchestration" won't match "orchestrate").
- No undo, other than an intact master profile and confirmation prompts on
  destructive actions.

## License

No license is granted. The source is here for reference; it isn't licensed for
reuse or redistribution.
