# Security policy

Skipper reads Claude Code session data (your prompts and code) and can start Claude Code on your behalf, so security reports get priority.

## Reporting a vulnerability

Please use [GitHub private vulnerability reporting](https://github.com/bilol-makhmudov/skipper/security/advisories/new) instead of a public issue. Include steps to reproduce and the version (`skipper --version`). You can expect a first reply within a few days.

## Design

- Binds to `127.0.0.1` by default and rejects requests whose `Host` header is not a loopback name (DNS rebinding).
- Binding to any other address requires a random access token, exchanged for an `HttpOnly`, `SameSite=Strict` cookie.
- Write requests need `X-Skipper: 1`, `Content-Type: application/json` and a same-origin `Origin`, and bodies are capped at 64 KB. `--read-only` disables writes entirely.
- Session and task IDs are validated against strict patterns before they touch the filesystem. Static files come from a fixed allowlist.
- Messages are passed to the Claude Code CLI as an argument list after `--`, never through a shell, and are limited to 5 per minute.
- Strict Content-Security-Policy with no inline scripts or styles. No third-party requests.
