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

- A technical founder clones the repo, builds it and adds it to Claude Code or
  Claude Desktop, then gets a named mentor recommendation with contact details
  and a draft intro when they raise a mentor-worthy question.
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
| Escalation action | Recommend a mentor + contact info + one-line reason + draft intro. No auto-notify, no booking. |
| Guidance | Produced by the host model, never by the server. |
| Profile building | Host model fills a structured schema; server only stores it. No server-side LLM. |
| Licence | MIT, open source. |
| Language | TypeScript on the official MCP TypeScript SDK, tests in Vitest. |
| Install | Clone, `npm install`, `npm run build`, then `claude mcp add` or the Claude Desktop JSON config. No npm publishing, no `.mcpb` bundle in v1. The README gives absolute paths for both `node` and `dist/server.js`, because Claude Desktop does not load the shell's PATH (a common failure with nvm). |
| Test group | Technical founders. The `.mcpb` bundle is built when a non-technical founder is to install v1 without the builder present; a setup the builder does in person does not trigger it (see `docs/designs/founder-mentor-escalation.md`). |

Why MCP and not a Claude Code skill: a skill runs only inside Claude Code and
has no runtime of its own to hold OAuth tokens or a database connection. The
MCP server works across clients and is the right shape for the later step to a
real, authenticated mentor database.

## 4. Architecture

```
Founder ── AI client (v1: Claude Code / Claude Desktop; other clients are roadmap)
                 │  host model answers the question itself
                 │  and decides when to call a tool
                 ▼
         futury MCP server (stdio, local)
           ├─ log_interaction ──► ProfileStore ──────────► $FUTURY_HOME/profile.json
           ├─ find_mentor ──────► Matcher ──► Intro           ▲
           │        │               └─ MentorDirectory ──► mentors.json (mock)
           │        └─ appends recommendation ─► ProfileStore ┘ (also stage fallback)
           └─ list_mentors ─────► MentorDirectory

npm run report ──► Report ──► reads profile.json, prints paste-ready summary
```

Units, each testable on its own:

- **server** (`src/server.ts`): registers the three tools, validates input,
  maps results and errors to MCP tool results. No business logic. At startup
  it logs one stderr line with the package version and the resolved
  `FUTURY_HOME` and mentor-file paths, so a wrong roster path is visible in
  the client's MCP log.
- **Labels** (`src/labels.ts`): the single table of category and stage labels
  (§5.5), used by Intro, Matcher's `reason` and Report.
- **ProfileStore** (`src/profile.ts`): reads and appends profile entries
  (`interaction` and `recommendation`) with a temp-file-and-rename write
  (§7), returns the latest known stage. Appends within one server process go
  through a single in-process queue, so parallel tool calls (the host may call
  `log_interaction` and `find_mentor` at once) never lose an entry.
- **MentorDirectory** (`src/mentors.ts`): loads and validates the mentor file.
- **Matcher** (`src/matcher.ts`): pure function, `(request, mentors) -> match | null`.
- **Intro** (`src/intro.ts`): pure function building `draft_intro` from the
  template in §5.2.
- **Report** (`src/report.ts`, run as `npm run report`): pure summary of a
  profile plus a thin CLI that prints it.

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

Behaviour: append `{type: "interaction", timestamp, question, topic,
stage_hint, key_facts}` to `profile.json`. Returns `{ok: true, entries: <count>}`,
where `count` is the total number of entries in `profile.json`.

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

The tool description tells the host to always pass `stage` when the
conversation reveals the founder's current stage, so a stage change is used
at once rather than an older `stage_hint` from the profile.

Output: a ranked shortlist of up to 3 candidates (§6). The host picks the one
that best fits what the founder actually said, using each candidate's
`focus`, tells the founder why, and may mention the others.

```json
{
  "candidates": [
    {
      "mentor": {"id": "m-003", "name": "...", "focus": "...", "contact": {"email": "...", "booking_url": "..."}},
      "reason": "fundraising, seed-stage: Led two Series A rounds in deep tech",
      "fallback_used": false,
      "draft_intro": "Hi <mentor name>, I'm [your name] from [your startup], a seed-stage founder in the FUTURY network ..."
    }
  ],
  "profile_logged": true
}
```

`draft_intro` is a short English message the founder can send after filling
in `[your name]` and `[your startup]`, one per candidate.
The tool description tells the host to show it unchanged apart from asking
the founder to fill those placeholders, to rewrite or translate it only when
the founder asks, and to write `notes` as one first-person sentence suitable
for the intro. Template, in order:

1. Greeting with the mentor's name.
2. Who the founder is: "I'm [your name] from [your startup], <stage label
   with article> founder in the FUTURY network" (§5.5), or "..., a founder in
   the FUTURY network" when the stage is unknown.
3. The topic as a fixed plain label per `ChallengeCategory` (for example
   `legal_cap_table` → "legal and cap table questions", `other` → "a question
   outside the usual topics").
4. The founder's `notes` as one sentence, left out when absent or an empty
   string.
5. Why this mentor: their `focus`.
6. A request for a short call.

Output when nothing matches:

```json
{"candidates": [], "reason": "No mentor covers <category label>", "profile_logged": true}
```

The host then answers on its own and can suggest the founder contact FUTURY
directly.

Recommendation log: after matching, `find_mentor` appends
`{type: "recommendation", v: 1, timestamp, challenge_category, stage,
candidates: [{mentor_id, mentor_name}]}` to `profile.json`, in rank order.
`stage` is the resolved stage (§6) or `null` when unknown; `candidates` is
empty on a no-match. The server cannot know which candidate the host showed
first; the check-in covers that. Every result, match or not, carries
`profile_logged` (`true` when the append succeeded). When `find_mentor`
returns a tool error (missing or malformed mentor file, invalid input), no
recommendation entry is written. If the append fails (malformed or
unwritable profile), the candidates are still returned with
`profile_logged: false` and `profile_error` naming the file; a logging
failure never hides a recommendation.

### 5.3 `list_mentors` (Awareness)

Purpose: let the founder see who exists. The tool description tells the host
to call it when the founder asks which mentors are available or what they
cover.

Input: `challenge_category` (enum, optional) to filter.

Output: `{"mentors": [{id, name, focus, categories, stages, contact}]}` in
file order, filtered when a category is given; an empty list when nobody
matches. Read-only; nothing is logged.

### 5.4 Report (`npm run report`)

`npm run report` runs `node dist/report.js`, so `npm run build` comes first
(same as the server). It honours `FUTURY_HOME`. It prints plain text the
founder can paste to the builder, in this order:

1. `Interactions: <n>` (count of `interaction` entries).
2. `Recommendations: <n> (no match: <m>)` (count of `recommendation`
   entries; `m` = those with empty `candidates`).
3. `Mentors suggested:` one line per mentor, `<name>: <count>`, counting each
   appearance in a shortlist, highest count first, ties by name.
4. `Topics:` one line per category label, `<label>: <count>`, counting
   `interaction.topic` only (one per logged question; recommendations are
   already counted above), highest count first, ties by label.

A section with nothing to list prints `none` (e.g. `Mentors suggested: none`).

Missing profile: prints "No profile yet" and exits 0. Malformed profile (see
§7): prints the path and exits 1; the file is not changed.

### 5.5 Enums and labels

`ChallengeCategory` and its plain label (used in `draft_intro`, `reason` and
the report):

| Value | Label |
|---|---|
| `fundraising` | fundraising |
| `hiring` | hiring |
| `go_to_market` | go-to-market |
| `product` | product decisions |
| `pivot_strategy` | a possible pivot |
| `legal_cap_table` | legal and cap table questions |
| `leadership_team` | leadership and team questions |
| `other` | a question outside the usual topics |

`Stage` and its label with article: `idea` "an idea-stage", `pre_seed`
"a pre-seed", `seed` "a seed-stage", `series_a_plus` "a Series A or later".

## 6. Matching

Deterministic scoring over the mentor list:

- +2 if the mentor's `categories` contain `challenge_category`
- +1 if the mentor's `stages` contain the stage (when a stage is known)
- A mentor with no category match is never returned.
- Candidates are sorted by score, ties in file order, and the top 3 are
  returned. The host chooses among them using the founder's details (§5.2),
  so equally scored mentors all get suggested rather than only the first.
- `fallback_used` (per candidate) is `true` only when a stage is known and
  that mentor does not cover it; `false` when the stage matches or is
  unknown.

Stage resolution: the `stage` input if given; otherwise the latest
`stage_hint` among `interaction` entries in the profile; otherwise unknown.
A missing or malformed profile means unknown; matching continues.

`reason` format: `"<category label>, <stage label without article>: <focus>"`
when the stage is known and matched, `"<category label>: <focus>"`
otherwise. Example: `"fundraising, seed-stage: Led two Series A rounds in deep tech"`.

## 7. Data

`mentors.json` ships in the repo at `data/mentors.json`. The default path is
resolved from the package root via `import.meta.url`, never from the working
directory (clients start stdio servers in arbitrary directories).
`FUTURY_MENTORS_PATH` overrides it.

```json
[{"id": "m-001", "name": "Invented Name", "focus": "one line",
  "categories": ["fundraising"], "stages": ["pre_seed", "seed"],
  "contact": {"email": "mentor@example.org", "booking_url": "https://example.org/book"}}]
```

Mentor file rules (anything else is a schema violation):

- Top level is an array (may be empty).
- `id`: non-empty string, unique across the file.
- `name`, `focus`: non-empty strings.
- `categories`: non-empty array of `ChallengeCategory` values.
- `stages`: array of `Stage` values; empty means the mentor covers no stage
  (still matchable on category).
- `contact.email`: required, string. `contact.booking_url`: optional string.

All mentors in the shipped file are invented. Contact data uses `example.org`.
For a real founder test, `FUTURY_MENTORS_PATH` points at a roster of mentors
who agreed to be listed, saved outside the clone; it never enters the repo
(`.gitignore` also excludes `mentors.local.json` as a backstop).

`profile.json` lives in `FUTURY_HOME` (default: `path.join(os.homedir(),
".futury")`), never in the repo. It stays on the founder's machine; the
server sends it nowhere. Shape: a JSON array of entries, each either
`{type: "interaction", ...}` (§5.1) or `{type: "recommendation", ...}` (§5.2).
Malformed means: invalid JSON, a top level that is not an array, or an entry
that fails its schema.

Writes are read, append, write to a uniquely named temp file
(`profile.json.<pid>.<random>.tmp`) in the same directory, then rename. On a
failed write the temp file is removed. `FUTURY_HOME` is created with mode
0700 and `profile.json` with mode 0600, since it holds the founder's business
questions. Within one process appends are queued (§4). Two separate sessions
writing at the same moment (Claude Code and Desktop) can still lose one
entry; last write wins across processes, and that is accepted for v1.

Every entry carries `"v": 1` so a later profile format (see the parked LLM
profile plan) can tell old entries apart without changing the array shape.

Input limits, enforced by the strict input parse (§8): `question` and `notes`
at most 500 characters, `key_facts` at most 10 items of at most 200
characters each. Longer input returns `isError: true` naming the field.

## 8. Error handling

- Invalid tool input: tools are registered with their real zod schemas,
  enums as `z.enum`, so the schema advertised to the host model lists every
  allowed `ChallengeCategory` and `Stage` value. The MCP SDK version is pinned
  in `package.json`. An integration test checks that an invalid call comes
  back as a tool result with `isError: true` naming the field. If the pinned
  SDK instead returns a protocol error, the fields are registered as
  `z.unknown()` with the allowed values listed in each field's
  `.describe()` text, and each handler parses strictly and returns
  `isError: true` itself. Either way, the advertised schema or description
  contains the enum values (also covered by a test).
- Missing or malformed `mentors.json`: `find_mentor` and `list_mentors` return
  a tool error with the path; `log_interaction` keeps working.
- Malformed `profile.json`: `log_interaction` returns a tool error naming the
  file. `find_mentor` still returns its candidates with `profile_logged: false`
  and `profile_error` (§5.2). The server never overwrites or repairs it, so
  no founder data is lost.
- Missing `FUTURY_HOME`: created on the first write.
- The server writes logs to stderr only; stdout carries the MCP protocol.
  Log lines name the tool, the error class and the file path, never the
  founder's question, notes or key facts (client MCP logs are plain files).
- An unexpected exception in a handler is returned as `isError: true` with
  "internal error in <tool>" and logged as above; the server process keeps
  running.

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

- Matcher: unit tests for category match, stage ranking, fallback (stage
  known and unmatched), unknown stage (`fallback_used: false`), no match,
  `reason` format, shortlist capped at 3 in score-then-file order, fewer than
  3 matches returns only those, equally scored mentors all appear.
- ProfileStore: 20 parallel appends in one process all land (queue); a
  failed write leaves no temp file and the original untouched; new files get
  modes 0700/0600; every entry has `v: 1`; injected clock for timestamps (no
  real time in tests).
- Input limits: 501-character `question`/`notes` and an 11-item `key_facts`
  return `isError: true`; empty-string `notes` is treated as absent.
- Logging: a handler error's stderr line contains the tool name and path but
  not the founder's text.
- ProfileStore: append, `FUTURY_HOME` created on first write, latest-stage
  lookup from `interaction` entries only,
  malformed file (each malformed case in §7) is left untouched.
- MentorDirectory: valid file, empty array, missing file, each schema rule in
  §7, default path resolved independent of the working directory.
- Server: integration test with the SDK's in-memory client/server transport,
  calling all three tools end to end against a temp `FUTURY_HOME` and a
  fixture mentor file; invalid input returns `isError: true`; the listed
  tool schemas or descriptions contain every `ChallengeCategory` and `Stage`
  value;
  `log_interaction` works with a missing mentor file; `log_interaction`
  returns a tool error on a malformed profile; `find_mentor` returns a tool
  error on a missing or malformed mentor file; `find_mentor` uses the
  profile's stage when none is given; stage change: a profile `stage_hint` of
  `pre_seed` plus a `find_mentor` call with `stage: seed` ranks by `seed`.
- Draft intro: one per candidate; correct with and without `notes` and stage.
- Recommendation log: match and no-match both appended with candidates in
  rank order; malformed profile and unwritable profile both still return the
  candidates with `profile_logged: false` and `profile_error`.
- list_mentors: full list, category filter, empty result, missing mentor
  file returns a tool error.
- Report: summary of a fixture profile; missing profile; malformed profile
  exits 1 and leaves the file unchanged.
- Manual: in Claude Code and Claude Desktop, ask 10 questions (5 generic, 5
  mentor-worthy). At most 1 of 10 may be handled wrongly; more means rewording
  the tool descriptions. After any rewording, run a second, held-out set of
  10 questions (never used for tuning) in fresh sessions; the same 1-of-10
  limit applies. Check separately that substantive questions produce a
  `log_interaction` entry (via `npm run report`). Then ask "which mentors are
  there?" and check that `list_mentors` is called.

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
- Deferred in the CEO review, tracked in `TODOS.md`: gap feedback on a
  no-match, a "(found via Futury)" line in `draft_intro`, a German draft
  intro.
