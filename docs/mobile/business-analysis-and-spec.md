# Skipper Mobile — Business Analysis & Requirements Specification

**Subject:** Skipper Mobile, a native companion app for the Skipper dashboard
**Document type:** Combined Business Analysis + BRD/SRS + Prioritised Backlog
**Prepared for:** Biloliddin
**Date:** 13 September 2026
**Status:** v1.0 — draft for design and implementation. Platform: iOS first (Flutter), Android later from the same codebase.

---

## Table of contents

- [Part I — Business Analysis](#part-i--business-analysis)
  - [1. Executive summary](#1-executive-summary)
  - [2. The problem](#2-the-problem)
  - [3. Who it is for](#3-who-it-is-for)
  - [4. Alternatives today](#4-alternatives-today)
  - [5. Options considered and recommendations](#5-options-considered-and-recommendations)
  - [6. Risk register](#6-risk-register)
- [Part II — Requirements Specification](#part-ii--requirements-specification)
  - [7. Scope & objectives](#7-scope--objectives)
  - [8. Actors](#8-actors)
  - [9. Glossary](#9-glossary)
  - [10. Business rules](#10-business-rules)
  - [11. Functional requirements](#11-functional-requirements)
  - [12. Non-functional requirements](#12-non-functional-requirements)
  - [13. Interfaces: Skipper server additions](#13-interfaces-skipper-server-additions)
  - [14. Sample acceptance criteria](#14-sample-acceptance-criteria)
  - [15. Assumptions, constraints & dependencies](#15-assumptions-constraints--dependencies)
- [Part III — Product backlog](#part-iii--product-backlog)
  - [16. Epic map](#16-epic-map)
  - [17. User stories](#17-user-stories)
  - [18. Release plan](#18-release-plan)
  - [19. Out of scope](#19-out-of-scope)

---

# Part I — Business Analysis

## 1. Executive summary

Skipper already answers "what are my Claude Code sessions doing?" on the Mac. The gap is **distance from the desk**. Work with Claude Code is long-running and asynchronous: loops sleep for 20 minutes, subagents run in the background, permission prompts and questions arrive while you are making tea. The browser dashboard reaches a phone only awkwardly (a token URL, Safari, no microphone over plain Wi-Fi, no push-style alerts).

Skipper Mobile is a native iPhone app that connects to the Skipper server running on the user's Mac **over the same Wi-Fi network**. Nothing goes through a cloud service. Its defining feature is a **voice agent**: one assistant that can see every session, subagent, loop, background job, task list and recent activity that Skipper sees, and answers spoken questions such as *"What is the Lutra session doing?"*, *"Did anything need me in the last hour?"* or *"How far along is the checkout redesign?"* — out loud.

The core finding: the valuable thing on the phone is not a smaller copy of the dashboard. It is **a briefing you can ask for without looking**, plus fast handling of the few moments that truly need you (a permission prompt, a question, a finished turn).

## 2. The problem

| # | Situation | What happens today |
|---|---|---|
| P1 | Away from the Mac (kitchen, sofa, another room) while sessions run | You walk back to check, or you don't know that a session has been stuck on a permission prompt for 40 minutes |
| P2 | Several sessions, subagents and loops at once | Understanding the whole picture needs reading many screens; there is no summary |
| P3 | Hands or eyes busy | Reading and typing on a phone is slow; there is no voice path into Claude Code state |
| P4 | Want to steer ("tell the docs session to stop after this slice") | Needs a terminal or the Mac dashboard |
| P5 | Browser on the phone | Token URL to type, no microphone over http, no background alerts, awkward layout for one-handed use |

## 3. Who it is for

| Segment | Description | Primary need |
|---|---|---|
| **S1 — Solo power user (primary)** | Runs 2–10 Claude Code sessions, loops and background agents on one Mac, often for hours | Know when something needs them; get a spoken status without walking to the desk |
| S2 — Multi-project developer | Several repos, teams and task lists | Cross-session summaries ("what finished today?") |
| S3 — Future: Android user | Same needs on Android | Same app from the Flutter codebase |

## 4. Alternatives today

| Alternative | Strengths | Gaps for this use |
|---|---|---|
| Skipper web dashboard on the phone (`--host 0.0.0.0`) | Already works, full data | Token URL, no mic over http in Safari, no voice answers, alerts only while the tab is open |
| Claude mobile app with Remote Control | Official, chat with one running session | One session at a time; no cross-session overview, subagents, loops, usage or Skipper activity |
| Terminal via SSH app | Full control | Not glanceable, no voice, high effort |
| Push notification services (ntfy, Pushover) via hooks | Real push | One-way, no context, needs a cloud relay |

**Positioning:** the only tool that gives a **spoken, cross-session briefing** of Claude Code work, with a local-only architecture.

## 5. Options considered and recommendations

### 5.1 Connection between phone and Mac

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **A. Direct LAN to Skipper (HTTP + SSE), paired with a token** | No cloud, low latency, reuses the existing API and event stream | Works only on the same network; plain HTTP on LAN is sniffable | **Recommended for v1** |
| B. LAN with TLS (self-signed cert, fingerprint pinned at pairing) | Encrypted on shared networks; native apps can pin a cert (unlike Safari) | Cert generation on the Mac, more setup code | **v1.1 hardening** |
| C. Private overlay network (Tailscale) | Works away from home | Extra app and account | Documented option, not built in |
| D. Cloud relay | Works anywhere, real push | Sends session data off the machine; contradicts Skipper's privacy promise | Rejected |

**Discovery and pairing (recommended):** the Mac advertises Skipper on the local network with Bonjour (`_skipper._tcp`, via the built-in `dns-sd` tool, no dependency). The dashboard shows a **"Connect phone" QR code** containing host, port and a pairing token. The app scans it once and stores the token in the iOS Keychain. Manual entry is the fallback.

### 5.2 Voice input (speech to text)

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **A. iOS on-device speech recognition** (`SFSpeechRecognizer` through `speech_to_text`) | Free, fast, private (on-device where supported), works offline | Accuracy for code words varies | **Recommended** |
| B. Whisper on the Mac | Better with technical terms | Heavier, needs a model download | Later option |
| C. Cloud STT | Accurate | Data leaves the network | Rejected |

A native app gets the microphone over plain LAN HTTP — the browser's "HTTPS only" restriction does not apply.

### 5.3 Voice output (text to speech)

| Option | Verdict |
|---|---|
| **A. iOS `AVSpeechSynthesizer` (`flutter_tts`) with enhanced/premium system voices** | **Recommended** — free, on-device, sentence-by-sentence as text streams in |
| B. macOS `say` streamed as audio | Rejected — worse latency, extra transport |

### 5.4 The voice agent's brain

The agent must answer from **live Skipper context**: all sessions, states, plans, subagents, loops, workflows, PRs, activity, usage and recent conversation.

| Option | How | Pros | Cons | Verdict |
|---|---|---|---|---|
| A. Snapshot in the prompt | Skipper builds a compact JSON briefing and sends it with each question to headless Claude Code | Simple | Large prompts; cannot drill into a specific conversation | Phase 1 fallback |
| **B. Headless Claude Code + Skipper tools (MCP)** | Skipper runs `claude -p --output-format stream-json` with a small Skipper MCP server (read-only tools: `list_sessions`, `get_session`, `get_conversation`, `get_activity`, `get_usage`) and no other tools | Runs on the user's existing Claude subscription on the Mac, no API key on the phone; the agent fetches only what the question needs; streams tokens for fast speech | A few seconds of start-up per question | **Recommended** |
| C. Claude API directly from the phone | Direct | Needs an API key on the device and a context sync; key handling risk | Rejected for v1 |
| D. On-device model | Private | Too small for cross-session reasoning | Rejected |

**Recommended agent contract:** the agent is **read-only by default**. Actions ("tell the docs session to stop after this slice", "add a note") are proposed by the agent and **confirmed by the user** (tap or spoken "yes") before Skipper performs them through its existing write API.

### 5.5 Framework

**Flutter** (the team's existing skill; moneymanager uses Flutter + Riverpod). iOS first; Android from the same code later. State: Riverpod. Secure storage: `flutter_secure_storage`.

## 6. Risk register

| ID | Risk | L | I | Mitigation |
|---|---|---|---|---|
| R1 | Token sniffed on an untrusted Wi-Fi | M | H | v1: warn when not on a known network, allow revoking the token from the Mac; v1.1: TLS with pinned fingerprint |
| R2 | Voice agent latency feels slow (headless start-up) | H | M | Stream partial text, speak first sentence early, show "looking at 3 sessions…" progress; keep a warm agent process per conversation |
| R3 | Agent answers from stale or invented state | M | H | Tools read live Skipper data; system prompt requires citing session names and times; never guess |
| R4 | Agent performs an unwanted action | L | H | Read-only tools; actions need explicit confirmation; server enforces the same write rules as the dashboard |
| R5 | iOS Local Network permission denied | M | M | Explain before the system prompt; detect and show recovery steps |
| R6 | Mac asleep, so the server is unreachable | H | M | Clear "Mac unreachable" state; suggest `caffeinate`/Energy settings; retry with backoff |
| R7 | Speech recognition mishears project names | M | M | Feed session titles and project names as contextual strings to the recognizer; agent does fuzzy matching |
| R8 | Headless agent runs consume the user's Claude usage | M | M | Default to a fast model; show usage of the voice agent in Skipper's Usage page |

---

# Part II — Requirements Specification

## 7. Scope & objectives

### 7.1 Objectives

| ID | Objective | Measure |
|---|---|---|
| O1 | Know within seconds when something needs you | Permission/question alert on the phone within 5 s of the hook event while the app is open or recently backgrounded |
| O2 | Get a spoken cross-session briefing | "What's going on?" answered, first words spoken within 4 s on a typical home network |
| O3 | Handle the moments that need you from the phone | Reply to a waiting session or open the resume command in ≤ 3 taps |
| O4 | Stay local and private | Zero requests to anything but the paired Mac |

### 7.2 In scope (v1)

Pairing and discovery, Home briefing, sessions list and detail (read), conversation view, replying to sessions, notes and task edits, activity feed, alerts while the app is running, **voice agent with spoken answers**, settings.

### 7.3 Out of scope (v1)

Android build, off-network access, real APNs push, running Claude Code on the phone, Apple Watch, widgets (all in the later release plan).

## 8. Actors

| Actor | Description |
|---|---|
| User | Owner of the Mac and the iPhone |
| Skipper server | Node process on the Mac; source of truth for sessions, activity, usage; performs writes |
| Voice agent | Headless Claude Code started by the Skipper server with read-only Skipper tools |
| Claude Code sessions | The sessions being observed and steered |

## 9. Glossary

| Term | Meaning |
|---|---|
| Session | A Claude Code conversation (terminal or background) |
| State | Needs permission, Needs you, Working, Sleeping (loop), Ended |
| Subagent | An agent started by a session (Agent/Task tool) |
| Loop | A self-paced `/loop` that sleeps until its next wakeup |
| Briefing | The agent's spoken summary of what matters now |
| Pairing | One-time exchange of host, port and token from the Mac to the phone |

## 10. Business rules

| ID | Rule |
|---|---|
| BR-1 | The phone talks only to the paired Skipper server. No third-party network calls. |
| BR-2 | Every request carries the pairing token; the server rejects missing or wrong tokens. |
| BR-3 | The voice agent can read everything Skipper can read, and can change nothing without a user confirmation. |
| BR-4 | A confirmed action goes through the same server write API as the dashboard (same validation, rate limits, read-only mode). |
| BR-5 | If Skipper runs with `--read-only`, the app hides every write and the agent never offers actions. |
| BR-6 | Transcript text shown or spoken is never stored on the phone beyond the current app session, except the voice conversation history the user chooses to keep. |
| BR-7 | Revoking the token on the Mac disconnects every paired phone. |

## 11. Functional requirements

Priority: **M** must (v1), **S** should (v1 if time), **C** could (later).

### 11.1 Pairing & connection (FR-1xx)

| ID | Requirement | P |
|---|---|---|
| FR-101 | Discover Skipper servers on the local network via Bonjour and list them by Mac name | M |
| FR-102 | Pair by scanning the QR code shown in the Skipper dashboard ("Connect phone") | M |
| FR-103 | Pair manually by entering host, port and token | M |
| FR-104 | Store the token in the iOS Keychain; support more than one Mac | S |
| FR-105 | Show connection state (connected, reconnecting, Mac unreachable) and retry with backoff | M |
| FR-106 | Explain and request the iOS Local Network permission before first discovery | M |

### 11.2 Home & briefing (FR-2xx)

| ID | Requirement | P |
|---|---|---|
| FR-201 | Home shows the attention summary: counts of Needs permission, Needs you, Working, Sleeping | M |
| FR-202 | Home lists sessions that need you first, with the reason (tool and command, question, last reply) | M |
| FR-203 | Home shows in-flight work: working sessions with plan progress, running subagents, next loop wakeup | M |
| FR-204 | A prominent voice button opens the voice agent from Home | M |
| FR-205 | Pull to refresh; live updates through the server event stream | M |

### 11.3 Sessions (FR-3xx)

| ID | Requirement | P |
|---|---|---|
| FR-301 | Sessions list grouped by state, searchable, filterable by project | M |
| FR-302 | Session detail: title, state, project, branch, model, tokens, turn timer, current tool, plan/todos, tasks, subagents, loop countdown, PRs and links | M |
| FR-303 | Conversation view: user and Claude messages with collapsed tool runs, newest at the bottom, live-updating | M |
| FR-304 | Reply to a session (sends through the existing message API) with keyboard dictation | M |
| FR-305 | Add, edit and delete private notes | S |
| FR-306 | Create, rename, complete and delete tasks | S |
| FR-307 | Copy the resume command for ended sessions | C |

### 11.4 Activity & alerts (FR-4xx)

| ID | Requirement | P |
|---|---|---|
| FR-401 | Activity feed grouped by time with unread markers and filters (needs you, finished, loops, subagents, PRs) | M |
| FR-402 | While the app is open or recently backgrounded: sound, haptic and local notification for permission prompts and questions | M |
| FR-403 | Optional chime when a turn finishes (loops excluded, like the dashboard) | S |
| FR-404 | Tapping an alert opens the session | M |

### 11.5 Voice agent (FR-5xx) — flagship

| ID | Requirement | P |
|---|---|---|
| FR-501 | Push-to-talk and tap-to-toggle listening, with a live transcript of what was heard | M |
| FR-502 | The agent answers questions about any session, subagent, loop, workflow, background job, task list, PR, activity and usage that Skipper knows | M |
| FR-503 | Answers stream as text and are spoken sentence by sentence; the user can interrupt by tapping or speaking | M |
| FR-504 | Follow-up questions keep context ("and the other one?") within a voice conversation | M |
| FR-505 | "Brief me" one-tap action: what needs me, what finished, what is running, what is next | M |
| FR-506 | Answers name sessions and link to them (tap to open) | M |
| FR-507 | The agent can propose actions (reply to a session, add a note, create/complete a task); nothing runs until the user confirms | S |
| FR-508 | Voice settings: voice, speaking rate, auto-speak on/off, language | S |
| FR-509 | Hands-free mode: after speaking, listen again automatically until the user says "stop" or is silent | C |
| FR-510 | Proactive voice alert: speak "Checkout needs permission to run fastlane" when an alert arrives and hands-free mode is on | C |

### 11.6 Settings (FR-6xx)

| ID | Requirement | P |
|---|---|---|
| FR-601 | Manage paired Macs, forget a Mac | M |
| FR-602 | Theme: system, light, dark (matching Skipper's palette) | S |
| FR-603 | Alert preferences: sound, haptics, turn chimes | S |

## 12. Non-functional requirements

| ID | Requirement |
|---|---|
| NFR-1 | **Privacy:** no analytics, no third-party SDKs that phone home, no network calls except to the paired Mac |
| NFR-2 | **Security:** token in Keychain; token never logged; server compares tokens in constant time; v1.1 TLS with certificate pinning |
| NFR-3 | **Latency:** Home renders cached state instantly and live state within 1 s on LAN; voice first spoken words ≤ 4 s (p50) |
| NFR-4 | **Resilience:** survives Mac sleep, Wi-Fi changes and server restarts with automatic reconnect |
| NFR-5 | **Accessibility:** Dynamic Type, VoiceOver labels, 44 pt targets, WCAG AA contrast, reduced motion |
| NFR-6 | **Battery:** event stream closed after 60 s in background; no polling while backgrounded |
| NFR-7 | **Portability:** no iOS-only code outside platform adapters, so Android is a build target, not a rewrite |
| NFR-8 | **Quality:** unit tests for API client and parsing, widget tests for key screens, server tests for new endpoints |

## 13. Interfaces: Skipper server additions

Existing (reused): `GET /api/sessions`, `GET /api/sessions/:id`, `GET /api/activity`, `GET /api/usage`, `GET /api/events` (SSE), write endpoints for messages, notes and tasks.

New:

| Endpoint | Purpose |
|---|---|
| `GET /api/sessions/:id/conversation?limit=` | Readable conversation: user/assistant messages and collapsed tool runs (tail of the transcript only) |
| `POST /api/agent/ask` | Body `{ conversationId?, text }`. Streams the voice agent's answer as SSE events: `status` (e.g. "Reading 3 sessions"), `delta` (text), `links` (session ids mentioned), `proposal` (an action awaiting confirmation), `done` |
| `POST /api/agent/confirm` | Confirms a proposed action by id; executes it through the normal write path |
| `GET /api/pairing` (Mac-only, loopback) | Returns the pairing payload for the QR code |
| Bonjour | `_skipper._tcp` advertised with the Mac name and port when LAN mode is on |

**Agent runtime (server side):** `claude -p --output-format stream-json --include-partial-messages --no-session-persistence --strict-mcp-config --mcp-config <skipper-tools> --tools "" --system-prompt <skipper agent prompt>`; tools served by a zero-dependency stdio MCP server inside the Skipper package that reads from the same Store.

## 14. Sample acceptance criteria

**FR-102 Pair by QR**
- Given Skipper runs in LAN mode on the Mac and the dashboard shows "Connect phone",
- when the user scans the QR code with the app,
- then the app stores the token in the Keychain, shows the Mac name and lands on Home with live data within 2 s.

**FR-502 Voice agent answers about a session**
- Given the session "Lutra session history" is working and running Bash for 6 minutes,
- when the user asks "What is the Lutra session doing?",
- then the agent's spoken answer names the session, says it is running a command and for how long, and the answer shows a link that opens that session.

**FR-507 Confirmed action**
- Given the agent proposes "Send 'stop after this slice' to Migrate docs",
- when the user says "no" or taps Cancel,
- then nothing is sent; when the user taps Send, the message goes through `POST /api/sessions/:id/message` and the rate limit applies.

**BR-5 Read-only**
- Given Skipper was started with `--read-only`, the app shows no reply box, note or task edits, and the agent never proposes actions.

## 15. Assumptions, constraints & dependencies

- The Mac runs Skipper ≥ 0.6 with LAN mode enabled by the user (the user starts it; the app cannot).
- The Mac has Claude Code installed and signed in (needed for the voice agent).
- Phone and Mac are on the same Wi-Fi; client isolation is off on that network.
- iOS 17+; Flutter 3.38+; Xcode available for building. Distribution: personal device builds first; TestFlight later.
- iOS permissions: Local Network (`NSLocalNetworkUsageDescription`, `NSBonjourServices`), Microphone, Speech Recognition, ATS exception for local networking (`NSAllowsLocalNetworking`).

---

# Part III — Product backlog

## 16. Epic map

| Epic | Name | FRs |
|---|---|---|
| E1 | Connect | FR-101..106 |
| E2 | Glance | FR-201..205, FR-401..404 |
| E3 | Sessions | FR-301..307 |
| E4 | Voice agent | FR-501..510 |
| E5 | Settings & polish | FR-601..603, NFRs |
| E6 | Server support | Section 13 |

## 17. User stories

| ID | Story | Epic | P |
|---|---|---|---|
| US-1 | As a user I scan a QR code once and my phone is connected to Skipper on my Mac | E1 | M |
| US-2 | As a user I open the app and immediately see what needs me | E2 | M |
| US-3 | As a user I feel a haptic and hear a chime when a session needs permission | E2 | M |
| US-4 | As a user I read a session's conversation and reply by dictation | E3 | M |
| US-5 | As a user I ask "what's going on?" and hear a short briefing across all sessions | E4 | M |
| US-6 | As a user I ask about a specific session, subagent or loop by name and get a precise answer | E4 | M |
| US-7 | As a user I ask a follow-up without repeating the session name | E4 | M |
| US-8 | As a user I tell the agent to message a session, confirm, and it is sent | E4 | S |
| US-9 | As a user I tick a task done from the phone | E3 | S |
| US-10 | As a user I can see and forget paired Macs | E5 | M |

## 18. Release plan

| Release | Contents |
|---|---|
| **M0 — Server groundwork** | Conversation endpoint, agent endpoint with MCP tools, pairing payload + QR in dashboard, Bonjour advertising, tests |
| **M1 — iOS alpha (read + voice)** | Pairing, Home, sessions list/detail, conversation, activity, voice agent (ask, stream, speak, follow-ups, Brief me) |
| **M2 — Steer** | Replies, notes, tasks, agent action proposals with confirmation, in-app alerts |
| **M3 — Hardening** | TLS + pinning, hands-free mode, proactive voice alerts, accessibility pass |
| **M4 — Android** | Android build, permissions, NSD discovery, store-ready polish |

## 19. Out of scope

Cloud relay or accounts; APNs remote push; access away from the home network without a user-managed VPN; running agents on the phone; editing code or approving Claude Code permission prompts remotely (Claude Code exposes no public API to answer a prompt in a running terminal).
