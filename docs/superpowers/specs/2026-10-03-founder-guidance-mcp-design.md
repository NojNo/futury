# Futury v1: Founder Guidance + Mentor Escalation MCP

Date: 2026-10-03
Status: design approved in conversation, awaiting spec review

## 1. Why

FUTURY (Frankfurt/Rhine-Main, one of Germany's ten Startup Factories) matches
founders to mentors once, at intake, through a curated and personally reviewed
application. Founders, especially first-time founders, need help in real time
and often for small things, and the need for a specific mentor shows up later
and changes as the startup moves.

Futury is meant to become an open-source "founder operating system": a set of
capabilities a founder uses inside the AI tools they already work in (Claude,
OpenAI clients, CLI agents). v1 ships the first capability only:

> The founder gets ad-hoc guidance in their AI client and, when a question
> needs human depth, is pointed to the right mentor for a 1:1.

## 2. Success criteria

- A founder adds the Futury MCP server to an MCP-capable client and, without
  any other setup, gets a named mentor recommendation with contact details
  when they raise a mentor-worthy question.
- Small, generic questions are answered by the host model and do not trigger
  a mentor recommendation.
- Each substantive interaction is stored in a local profile, so the profile
  shows how the founder's stage and topics change over time.
- The repository contains no proprietary dependency and is publishable under
  MIT.

## 3. Decisions

| Topic | Decision |
|---|---|
| Interface | MCP only. No REST/OpenAPI layer. |
| Deployment | Local, one stdio server per founder. No hosting, no auth. |
| Official Claude Connector listing | Not in v1 (needs a remote server + OAuth). |
| Mentor data | Mocked, invented profiles in a JSON file. |
| Escalation action | Recommend a mentor + contact info + one-line reason. No auto-notify, no booking. |
| Guidance | Produced by the host model, never by the server. |
| Profile building | Host model fills a structured schema; server only stores it. No server-side LLM. |
| Licence | MIT, open source. |
| Language | TypeScript on the official MCP TypeScript SDK, published to npm so `npx` can run it. |

Why MCP and not a Claude Code skill: a skill runs only inside Claude Code and
has no runtime of its own to hold OAuth tokens or a database connection. The
MCP server works across clients and is the right shape for the later step to a
real, authenticated mentor database.

## 4. Architecture

```
Founder ── AI client (Claude Desktop / Claude Code / OpenAI client / CLI agent)
                 │  host model answers the question itself
                 │  and decides when to call a tool
                 ▼
         futury MCP server (stdio, local)
           ├─ log_interaction ──► ProfileStore ──► $FUTURY_HOME/profile.json
           └─ find_mentor ──────► Matcher ──────► mentors.json (mock)
                                     └─ reads ProfileStore for the stage fallback
```

Units, each testable on its own:

- **server** (`src/server.ts`): registers the two tools, validates input,
  maps results and errors to MCP tool results. No business logic.
- **ProfileStore** (`src/profile.ts`): reads and appends profile entries,
  returns the latest known stage.
- **MentorDirectory** (`src/mentors.ts`): loads and validates the mentor file.
- **Matcher** (`src/matcher.ts`): pure function, `(request, mentors) -> match | null`.

## 5. Tools

### 5.1 `log_interaction` (Profile Building)

Purpose: record what the founder is working on so the profile builds up over
time. The tool description tells the host model to call it on substantive
founder questions, not on small talk.

Input:

| Field | Type | Required |
|---|---|---|
| `question` | string, the founder's question in short form | yes |
| `topic` | enum `ChallengeCategory` | yes |
| `stage_hint` | enum `Stage` | no |
| `key_facts` | string[] (e.g. "team of 3", "runway 6 months") | no |

Behaviour: append `{timestamp, question, topic, stage_hint, key_facts}` to
`profile.json`. Returns `{ok: true, entries: <count>}`.

### 5.2 `find_mentor` (Escalation)

Purpose: name the right mentor when the question needs a human. The tool
description tells the host model to call it for decisions with high stakes or
little generic answer: fundraising strategy, senior hires, pivots, cap table
and legal structure, co-founder conflict. For small or generic questions the
host answers directly.

Input:

| Field | Type | Required |
|---|---|---|
| `challenge_category` | enum `ChallengeCategory` | yes |
| `stage` | enum `Stage` | no, falls back to latest `stage_hint` in the profile |
| `notes` | string, short summary of the situation | no |

Output on a match:

```json
{
  "mentor": {"id": "m-003", "name": "...", "focus": "...", "contact": {"email": "...", "booking_url": "..."}},
  "reason": "Seed-stage fundraising, led two Series A rounds in deep tech",
  "fallback_used": false
}
```

Output when nothing matches: `{"mentor": null, "reason": "No mentor covers <category> at <stage>"}`.
The host then answers on its own and can suggest the founder contact FUTURY directly.

### 5.3 Enums

- `ChallengeCategory`: `fundraising`, `hiring`, `go_to_market`, `product`,
  `pivot_strategy`, `legal_cap_table`, `leadership_team`, `other`
- `Stage`: `idea`, `pre_seed`, `seed`, `series_a_plus`

## 6. Matching

Deterministic scoring over the mentor list:

- +2 if the mentor's `categories` contain `challenge_category`
- +1 if the mentor's `stages` contain the stage (when a stage is known)
- A mentor with no category match is never returned.
- Highest score wins; ties go to the first mentor in file order.
- `fallback_used: true` when the stage did not match and the mentor was
  chosen on category alone.

`reason` is built from the mentor's `focus` field and which criteria matched.

## 7. Data

`mentors.json` (shipped in the repo, path overridable with `FUTURY_MENTORS_PATH`):

```json
[{"id": "m-001", "name": "Invented Name", "focus": "one line",
  "categories": ["fundraising"], "stages": ["pre_seed", "seed"],
  "contact": {"email": "mentor@example.org", "booking_url": "https://example.org/book"}}]
```

All mentors in the shipped file are invented. Contact data uses `example.org`.

`profile.json` lives in `FUTURY_HOME` (default `~/.futury/`), never in the
repo. It stays on the founder's machine; the server sends it nowhere.

## 8. Error handling

- Invalid tool input: rejected by schema validation, returned as an MCP tool
  error naming the field.
- Missing or malformed `mentors.json`: `find_mentor` returns a tool error with
  the path; `log_interaction` keeps working.
- Malformed `profile.json`: tool error naming the file; the server does not
  overwrite or repair it, so no founder data is lost.
- Missing `FUTURY_HOME`: created on the first write.

## 9. gstack pairing (documentation, no code)

gstack (github.com/garrytan/gstack, MIT) runs as Claude Code skills that act
as an engineering team (review, QA, ship, security). Futury does not call
it. The README ships a CLAUDE.md snippet founders can paste so the host model
routes requests:

1. Small or generic question: answer directly.
2. Build/ship blocker in the founder's own product: use the matching gstack skill.
3. Needs human judgment or experience: `find_mentor`, then `log_interaction`.

On non-Claude-Code clients only the Futury half is available.

## 10. Testing

- Matcher: unit tests for category match, stage tie-break, fallback, no match.
- ProfileStore: append, latest-stage lookup, malformed file is left untouched.
- MentorDirectory: valid file, missing file, schema violation.
- Server: integration test with the SDK's in-memory client/server transport,
  calling both tools end to end against a temp `FUTURY_HOME` and a fixture
  mentor file.
- Manual: add the server to Claude Code and to one OpenAI-side MCP client,
  ask one generic and one fundraising question, check that only the second
  returns a mentor.

All fixtures are invented.

## 11. Out of scope for v1 (roadmap)

- **LLM-based profile building**: a dedicated feature with its own spec, see
  `docs/roadmap/llm-profile-building.md`.
- Remote MCP server with OAuth, a real FUTURY mentor database and official
  Connector listing. These are one later phase. The backend service may be
  closed source; the MCP server stays open.
- Co-founder escalation (same pattern, different pool).
- Content and masterclass recommendations for questions that need no human.
- Extension loader for local, uncommitted capability modules, and a
  `self_serve_alternative` field on `find_mentor`.
- Auto-notifying mentors or booking calendar slots.
