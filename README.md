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

## Install (Claude Code or Claude Desktop)

Prerequisites: Node.js 24 (22 also works), git, and Claude Code or Claude
Desktop.

```bash
git clone https://github.com/NojNo/futury.git
cd futury
npm install
npm run build
which node   # note this absolute path
pwd          # note this absolute path
```

### Claude Code

```bash
claude mcp add futury -- "$(which node)" "$(pwd)/dist/server.js"
```

### Claude Desktop

Claude Desktop does not load your shell's PATH, so use absolute paths for both
`node` and `dist/server.js`. Edit
`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or
`%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "futury": {
      "command": "/ABSOLUTE/PATH/TO/node",
      "args": ["/ABSOLUTE/PATH/TO/futury/dist/server.js"]
    }
  }
}
```

Restart Claude Desktop afterwards.

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

[gstack](https://github.com/garrytan/gstack) (MIT) is an optional companion
for Claude Code that acts as an engineering team; Futury does not depend on it.

## Your data

- The profile lives in `~/.futury/profile.json` (folder mode 0700, file mode
  0600). Change the folder with `FUTURY_HOME` (must be an absolute path).
- Futury sends nothing anywhere. Tool inputs and outputs do pass through your
  AI provider (Claude) under its terms.
- Logging is best-effort: your AI client decides when to call
  `log_interaction`, so a question can be missed or logged twice.

```bash
npm run report
```

## Using a real mentor roster

The repo only ships invented mentors (`data/mentors.json`). For a real
roster, get the JSON file from your program, save it **outside** this folder,
and set `FUTURY_MENTORS_PATH` to its absolute path in your client config
(`"env": { "FUTURY_MENTORS_PATH": "/ABSOLUTE/PATH/roster.json" }` in Claude
Desktop, `-e FUTURY_MENTORS_PATH=...` with `claude mcp add`). The file is
re-read on every call, so edits apply without a restart. Every listed mentor
must have agreed to be listed and to receive AI-drafted intros.

Roster format: an array of
`{ "id", "name", "focus", "categories": [...], "stages": [...], "contact": { "email", "booking_url"? } }`.
Categories: `fundraising`, `hiring`, `go_to_market`, `product`,
`pivot_strategy`, `legal_cap_table`, `leadership_team`, `other`. Stages:
`idea`, `pre_seed`, `seed`, `series_a_plus`.

## Troubleshooting

- **Tools don't appear in Claude Desktop:** check that both paths in the
  config are absolute and that `node --version` at that path is 22 or later.
- **Wrong or no mentors:** the server logs one startup line,
  `futury <version> home=<path> mentors=<path>`, to the client's MCP log
  (Claude Desktop on macOS: `~/Library/Logs/Claude/mcp-server-futury.log`).
  Check the `mentors=` path.
- **"must be an absolute path":** `FUTURY_HOME` or `FUTURY_MENTORS_PATH` is
  relative; use a full path.
- **"Profile file ...: malformed entries":** the profile was edited by hand or
  by another version. Futury never overwrites it; fix or move the file.

## Development

```bash
npm run typecheck
npm test          # builds, then runs Vitest including a stdio smoke test
```

## Licence

MIT, see `LICENSE`.
