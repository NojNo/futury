# Security policy

## Reporting a vulnerability

Please do not open a public issue. Report it privately through GitHub:
**Security → Report a vulnerability** on this repository. You will get a reply
within 7 days.

Useful to include: the affected version or commit, steps to reproduce, and the
impact you see (for example access to another user's profile file).

## Supported versions

Only the latest release on `main` receives fixes.

## Scope

futury runs locally and stores the founder profile in `FUTURY_HOME`. Reports
about file permissions, path handling, data leaking into logs, or the MCP tool
inputs are in scope. Issues in the AI client or in Claude itself are not.
