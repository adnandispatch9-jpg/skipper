<div align="center">

<img src="public/icon.svg" width="84" alt="Skipper logo">

# Skipper

**Mission control for Claude Code.** See every Claude Code session, subagent, `/loop` and todo list live in one local dashboard, and steer them without switching terminals.

[![CI](https://github.com/bilol-makhmudov/skipper/actions/workflows/ci.yml/badge.svg)](https://github.com/bilol-makhmudov/skipper/actions/workflows/ci.yml)
![Node 20+](https://img.shields.io/badge/node-%E2%89%A520-3c873a)
![Zero dependencies](https://img.shields.io/badge/dependencies-0-8ea2ff)
![Local first](https://img.shields.io/badge/data-stays%20on%20your%20machine-f0a93b)
[![MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

<img src="docs/demo.gif" alt="Skipper tour: the attention queue, a session with subagents, a permission prompt, a sleeping loop and a team task list, across five themes" width="100%">

</div>

## Why Skipper?

Running several Claude Code agents at once is powerful and hard to follow. One terminal is waiting for an answer, another has three background subagents in worktrees, a third is a `/loop` sleeping until CI finishes. Skipper answers the question you keep asking: **which session needs me right now?**

- **Needs you, Working, Sleeping.** Every live session gets a clear state, taken from Claude Code's own session status. Sessions waiting on you rise to the top, and the browser tab title shows the count.
- **Todo lists and task lists.** Watch Claude's plan fill up in real time, including team task lists with owners and blockers.
- **Subagents.** Background agents with name, model, worktree branch, and when each one last did something.
- **`/loop` countdowns.** See when a self-paced loop wakes next and why it went to sleep.
- **Workflows, PRs and artifacts.** Multi-agent workflow runs, linked pull requests and published artifacts, one click away.
- **Activity feed.** What happened while you were away, across every session: permission prompts, finished turns, loop ticks, subagents, PRs and workflow runs, with unread markers and filters.
- **Cost and history.** Spend, turns and lines changed for every session, searchable across all your projects.
- **Permission alerts with sound.** The moment Claude asks to run a command or edit a file, Skipper plays a chime, shows a desktop notification and moves the session to **Needs permission**.

## Steer, not just watch

<img src="docs/screenshots/session-light.png" alt="Session page: what Claude is doing now, the running tool, the plan, subagents and notes" width="100%">

- **Message Claude.** Type the next instruction and Skipper hands it to the official CLI (`claude --bg --resume <session>`), so the session continues in the background. Attach any time with `claude attach`.
- **Edit tasks.** Add, rename, complete and delete tasks in a session's task list. Deleting a task that still blocks others is refused.
- **Private notes.** Keep notes per session, and send one to Claude when you are ready.
- **Read-only when you want it.** Start with `--read-only` and every write is switched off.

<table>
<tr>
<td width="50%"><img src="docs/screenshots/tasks-paper.png" alt="Team task list with owners and blockers in the Paper theme"></td>
<td width="50%"><img src="docs/screenshots/loop-midnight.png" alt="A sleeping /loop with its countdown and workflow run in the Midnight theme"></td>
</tr>
<tr>
<td align="center">Team tasks with owners and blockers (Paper theme)</td>
<td align="center">A sleeping <code>/loop</code> and its workflow run (Midnight theme)</td>
</tr>
</table>

### On your phone

<table>
<tr>
<td width="50%"><img src="docs/screenshots/mobile-overview.png" alt="Skipper on a phone: sessions that need you and in-flight work, with a bottom tab bar"></td>
<td width="50%"><img src="docs/screenshots/mobile-permission.png" alt="A permission prompt on a phone, showing the exact command with a copy button"></td>
</tr>
</table>

Run `skipper --host 0.0.0.0` and open the printed link on your phone to check on agents from the couch.

## Quick start

Try it once, no install:

```bash
npx github:bilol-makhmudov/skipper
```

Then open **http://localhost:4317**. Skipper finds your sessions in `~/.claude` automatically, and new ones appear the moment they start. Add `--demo --open` for a tour with sample sessions.

### Set it up for everyday use

```bash
npm install -g github:bilol-makhmudov/skipper
skipper hooks install     # chime and notify on permission prompts
skipper service install   # keep it running in the background, start at login
```

Requires Node.js 20 or newer. Skipper has **zero runtime dependencies**.

### From source

```bash
git clone https://github.com/bilol-makhmudov/skipper.git
cd skipper
npm start          # or: npm run demo
```

## Never miss a permission prompt

```bash
skipper hooks install
```

This adds two official [Claude Code hooks](https://docs.anthropic.com/en/docs/claude-code/hooks) (`Notification` and `Stop`) to `~/.claude/settings.json`. Your other settings and hooks are kept, and a backup is saved next to the file. From then on, every new Claude Code session tells Skipper instantly when it:

| Event | What you get |
| --- | --- |
| Needs permission to use a tool | Urgent chime, desktop notification that stays until you click it, **Needs permission** state |
| Asks you a question | Chime and notification |
| Finishes its turn | Soft chime: "waiting for your next message" |
| Has been idle, waiting for input | Reminder chime |

Choose sound and desktop notifications from the bell menu, and use **Test alert** to hear it. Remove the hooks any time with `skipper hooks uninstall`. The hook only appends a line to `~/.skipper/events.jsonl` and exits, so it can never slow down or break a session.

> Tip: browsers only play sound after you have clicked the page once, so click anywhere in Skipper after opening it.

## Themes

System, Light, Dark, **Midnight** (true black for OLED screens), **Paper** (warm and serif) and **High contrast**. Pick one from the moon/sun button in the top bar. Skipper also works as an installable app on your phone or desktop.

## Keyboard shortcuts

`j` / `k` move between sessions, `g o` / `g a` / `g l` / `g h` jump to Overview, Activity, Live and History, `m` focuses the message box, `/` searches, and `?` shows the full list.

## Options

| Flag | Default | What it does |
| --- | --- | --- |
| `-p, --port <n>` | `4317` | Port to listen on (`$PORT` works too) |
| `--host <addr>` | `127.0.0.1` | Interface to bind. A non-loopback address turns on token access |
| `--claude-dir <dir>` | `~/.claude` | Claude Code data directory (`$CLAUDE_CONFIG_DIR` works too) |
| `--data-dir <dir>` | `~/.skipper` | Where Skipper keeps your notes |
| `--read-only` | off | Disable messages, notes and task edits |
| `--demo` | off | Serve fictional sample sessions |
| `-o, --open` | off | Open the dashboard in your browser |
| `hooks install` / `uninstall` / `status` | | Manage the permission and turn-finished alerts |

### Check on agents from your phone

```bash
skipper --host 0.0.0.0
```

Skipper prints a link with a one-time access token for every network address. Open it on your phone once and a secure cookie keeps you signed in. Without the token, nothing is served.

### Keep it running in the background

```bash
npm install -g github:bilol-makhmudov/skipper
skipper service install
```

Skipper starts at login and restarts if it stops: a launchd agent on macOS, a systemd user service on Linux. Check it with `skipper service status` and remove it with `skipper service uninstall`.

## How it works

Claude Code already records everything Skipper needs on your disk:

| Source | What Skipper reads |
| --- | --- |
| `~/.claude/projects/*/<session>.jsonl` | Titles, prompts, latest messages, todo lists, subagents, loops, workflows, PRs, cost |
| `~/.claude/projects/*/<session>/subagents`, `/workflows` | Subagent names, models, worktrees; workflow run results |
| `~/.claude/sessions/*.json` | Which sessions are live, and whether they are busy or idle |
| `~/.claude/tasks`, `~/.claude/teams` | Task lists and agent teams |
| `~/.skipper/events.jsonl` | Permission prompts and finished turns, written by `skipper hooks` |

Transcripts are read incrementally from the last byte seen, so a history of hundreds of megabytes stays fast. File watchers push changes to the browser over Server-Sent Events, with no polling and no refresh.

## Privacy and security

Your sessions contain your code and prompts, so Skipper treats them that way:

- **Nothing leaves your machine.** No telemetry, no CDN, no external requests. The UI is plain HTML, CSS and JavaScript served from the package.
- **Loopback only by default**, with Host header checks against DNS rebinding.
- **Writes are locked down.** They need a custom header, a JSON body and a same-origin request, and every ID and path is validated. Messages go to the `claude` CLI as an argument list, never through a shell.
- **Strict Content Security Policy.** Everything is rendered with `textContent`, never raw HTML.

See [SECURITY.md](SECURITY.md) to report a vulnerability.

## FAQ

**Can Skipper type into a Claude Code terminal that is already open?**
No. Claude Code has no public API for that. Messaging an open session starts a background copy that continues from the same conversation, and Skipper warns you before you send. For finished or idle-and-closed sessions, the message continues the session itself.

**Does it work with agent teams, worktrees and background agents?**
Yes. Team task lists, owners, worktree branches and background subagents all show up.

**Windows and Linux?**
Skipper is plain Node.js and runs anywhere Claude Code does.

**Is this an official Anthropic product?**
No. Skipper is an independent open-source project for people who use Claude Code.

## Contributing

Issues and pull requests are welcome. Run `npm test` before you open a PR (and `npm run screenshots` if you changed visuals), and see [CONTRIBUTING.md](CONTRIBUTING.md). If Skipper saves you a trip through your terminals, a ⭐ helps other Claude Code users find it.

## License

[MIT](LICENSE)
