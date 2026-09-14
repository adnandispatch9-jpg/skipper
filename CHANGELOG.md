# Changelog

## Unreleased

- Mark a "Your turn" session as seen and it stops counting toward Needs you, the tab title and the tab icon until it does something new. Permission prompts cannot be dismissed.
- iPhone app (Flutter, in `mobile/`) with QR pairing from the dashboard and a voice assistant for questions about your sessions, in English or Uzbek. Messages it drafts are only sent after you confirm.
- Optional voice: free local recognition with Whisper and spoken answers through edge-tts, or Azure AI Speech.
- The network access token persists across restarts; `skipper pair reset` issues a new one. `skipper service install --host 0.0.0.0` runs the service on your Wi-Fi.
- No dollar amounts anywhere. The recorded figure is an API list-price estimate, not what a Pro or Max subscriber pays; the usage page shows active sessions instead.
- Security: the assistant's internal key stays off the command line, voice requests are rate limited, and service logs are private with the token redacted.
- `skipper doctor` checks Node, Claude Code data, hooks, recent hook events, notifications, the service and the dashboard, and says what to run for anything missing.
- Quiet sessions say which tool they are still running.
- Reply from the Needs you queue opens the session ready to type.
- Multiple-choice questions from Claude are shown as questions, not permission prompts.
- Sessions started in the background are labeled, so they are not mistaken for terminal sessions.
- The dashboard opens immediately on start; session data follows when the first history scan finishes.
- Status dots, progress and usage bars stay visible in Windows High Contrast and other forced-color modes.
- Responses are gzipped and static files are cached with ETags.
- The browser tab icon shows an amber or red dot when a session is waiting or needs permission.

## 0.5.0 (2026-09-13)

- Refreshes do less work: subagent metadata is read once (62 file reads per refresh down to 5).
- Projects show as a scrollable chip row on phones.
- Working sessions show how long the turn has run, and warn after five quiet minutes.
- Session pages show that session's token totals, subagents included.
- `skipper hooks native on` sends system notifications for permission prompts and questions, even with no dashboard open.

## 0.4.0 (2026-09-13)

- Sending messages is limited to 5 per minute, and live connections are capped.
- Animated tour at the top of the README.
- Usage page: exact token counts per day, project and model (subagents included, each response counted once), with recorded cost only.
- Every theme's text now meets WCAG AA contrast (4.5:1), checked by a test.

## 0.3.0 (2026-09-13)

- Finished sessions get a Resume button that copies `cd <project> && claude --resume <id>`.
- Keyboard shortcuts: `j`/`k` between sessions, `g o|a|l|h` to jump, `m` to message, `?` for the list.
- `skipper service install | uninstall | status` keeps Skipper running in the background (launchd on macOS, systemd user service on Linux) and waits until it answers.
- New users see a one-time tip on the overview for turning on permission alerts.
- The dashboard's pure logic is unit-tested.

## 0.2.0 (2026-09-13)

### Added
- **Permission alerts with sound.** `skipper hooks install` connects Claude Code's `Notification` and `Stop` hooks. Sessions waiting for permission move to a **Needs permission** state, with a chime, a desktop notification and the exact command.
- **Activity feed.** What happened while you were away: permission prompts, finished turns, loop ticks, subagents, pull requests, artifacts, workflow runs and ended sessions. Unread markers, filters, and loop ticks merged per session.
- **Attention queue.** The overview ranks every session that needs you, permission prompts first, with the next action.
- **Phone layout.** Bottom tab bar (Needs you, Activity, Live, History), a permission banner with a copy button, and a message box pinned to the bottom.
- **Sidebar** with Live and History tabs and a project filter.
- Session page shows what the running tool is working on (file or command).
- `npm run screenshots` regenerates README screenshots from demo data.

### Fixed
- Loops no longer flicker into "Needs you" while their wakeup runs a few seconds late.
- Loops no longer chime every time they go back to sleep.
- Times between 45 and 59 seconds showed as "0m ago".
- The top bar overflowed on narrow phones.
- The hook event log is kept to its most recent 1000 events.

## 0.1.0 (2026-09-13)

- First release: a live, local dashboard for Claude Code sessions, todo lists, task lists, subagents, loops, workflows and PRs, with messaging, notes, task editing, six themes and `--demo` mode.
