# futury

An open-source MCP server that lets a founder's AI client point them to the
right FUTURY mentor at the moment they are stuck. v1 runs locally, ships with
three invented demo mentors and keeps a private profile of your questions on
your own machine.

## What it does

- `find_mentor` — for questions that need human experience (fundraising
  strategy, senior hires, pivots, cap table, co-founder conflict) it returns a
  shortlist of up to 3 mentors, each with a reason and a draft intro you can
  send after filling in your name and startup.
- `list_mentors` — shows which mentors exist and what they cover.
- `log_interaction` — records your substantive questions in a local profile.
- `npm run report` — prints a short summary of that profile.

Your AI client answers small questions itself; Futury only adds the mentor
recommendation and the local log.

## Install

Requires Node.js 24 (22 also works).

```bash
git clone https://github.com/NojNo/futury.git
cd futury
npm install
npm run build
```

Register it as a local (stdio) MCP server that runs `node dist/server.js`,
using absolute paths for both `node` and `dist/server.js`.

- **Claude Code** ([MCP docs](https://code.claude.com/docs/en/mcp)):
  `claude mcp add --scope user futury -- "$(which node)" "$(pwd)/dist/server.js"`
  (`--scope user` makes it available in all your projects).
- **Claude Desktop**: add it to the app's MCP config as described in
  [Connect to local MCP servers](https://modelcontextprotocol.io/docs/develop/connect-local-servers),
  then restart the app.

Optional environment variables, both absolute paths: `FUTURY_HOME` (profile
folder, default `~/.futury`) and `FUTURY_MENTORS_PATH` (mentor roster, default
the demo roster). Pass them to the server, e.g. in Claude Code:

```bash
claude mcp add --scope user -e FUTURY_HOME=/abs/path/.futury -e FUTURY_MENTORS_PATH=/abs/path/roster.json \
  futury -- "$(which node)" "$(pwd)/dist/server.js"
```

In Claude Desktop, add the same keys under `"env"` in the server's config entry.

## Recommended instructions for your AI client

Paste this into your `CLAUDE.md` (Claude Code) or your Project instructions
(Claude Desktop):

```
## Futury mentor routing
- Small or generic questions: answer directly.
- A blocker in building or shipping my own product: use the matching gstack skill if installed (/review, /qa, /ship, /cso).
- Questions that need human judgment or experience (fundraising strategy, senior hires, pivots, cap table, co-founder conflict): call find_mentor, then log_interaction.
- Every substantive question, whichever of the above answers it, also gets one log_interaction call. Skip small talk.
- If I ask which mentors exist, call list_mentors.
```

[gstack](https://github.com/garrytan/gstack) is an optional companion for
Claude Code; Futury does not depend on it.

## Your data

- The profile is `profile.json` in `FUTURY_HOME` (folder mode 0700, file mode
  0600). `npm run report` summarises it; if you set `FUTURY_HOME` for the
  server, set the same value for the report (`FUTURY_HOME=... npm run report`).
- Use one AI client at a time: two clients writing at the same moment (e.g.
  Claude Code and Claude Desktop) can lose a log entry.
- Futury sends nothing anywhere. Tool inputs and outputs do pass through your
  AI provider under its terms.
- Logging is best-effort: your AI client decides when to call
  `log_interaction`, so a question can be missed or logged twice.

## Using a real mentor roster

The repo only ships invented mentors (`data/mentors.json`). Save a real roster
**outside** this folder and point `FUTURY_MENTORS_PATH` at it. It is re-read on
every call. Every listed mentor must have agreed to be listed and to receive
AI-drafted intros.

Format: an array of
`{ "id", "name", "focus", "categories": [...], "stages": [...], "contact": { "email", "booking_url"? } }`.
Categories: `fundraising`, `hiring`, `go_to_market`, `product`,
`pivot_strategy`, `legal_cap_table`, `leadership_team`, `other`. Stages:
`idea`, `pre_seed`, `seed`, `series_a_plus`.

## Troubleshooting

On start the server logs `futury <version> home=<path> mentors=<path>` to
stderr, which your client writes to its MCP log (see
[Debugging](https://modelcontextprotocol.io/docs/tools/debugging)). Check
those paths first.

- **"must be an absolute path"**: `FUTURY_HOME` or `FUTURY_MENTORS_PATH` is
  relative.
- **"Profile file ...: malformed entries"**: the profile was edited by hand or
  by another version. Futury never overwrites it; fix or move the file.

## Contributing

See `CONTRIBUTING.md` (commits are signed off, DCO) and `SECURITY.md`.

## Licence

Apache License 2.0, see `LICENSE` and `NOTICE`.
