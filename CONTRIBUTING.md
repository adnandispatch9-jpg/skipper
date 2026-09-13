# Contributing to Skipper

Thanks for helping make Claude Code easier to steer.

## Setup

```bash
git clone https://github.com/bilol-makhmudov/skipper.git
cd skipper
npm run demo      # fictional sessions, no Claude Code data needed
npm start         # your real ~/.claude
npm test
npm run screenshots   # regenerates docs/screenshots from demo data (needs Chrome or Chromium)
```

Node.js 20+ is the only requirement. Please keep it that way: Skipper has no runtime dependencies, and new ones need a very good reason.

## Layout

| Path | Purpose |
| --- | --- |
| `src/transcript.js` | Folds transcript records into a session summary (pure, unit tested) |
| `src/store.js` | Incremental, read-only index of `~/.claude` |
| `src/actions.js` | Every write: notes, tasks, messages to the `claude` CLI |
| `src/server.js` | HTTP server, security checks, Server-Sent Events |
| `src/demo.js` | Fictional data for `--demo`, screenshots and tests |
| `public/` | The UI: plain HTML, CSS and JavaScript, no build step |

## Guidelines

- **Never ship real transcripts** in issues, tests or screenshots. Use `--demo` data.
- Claude Code's on-disk formats are not a public API. Parse defensively and skip what you don't understand.
- Render text with `textContent`, never `innerHTML`. The CSP forbids inline scripts and styles.
- Any new write must validate its input in `src/actions.js` and come with a test in `test/server.test.js`.
- Keep screens usable at 390px wide, in every theme.
