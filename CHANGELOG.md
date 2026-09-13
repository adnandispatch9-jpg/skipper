# Changelog

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
