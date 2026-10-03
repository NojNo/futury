# Futury v1 MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local, open-source MCP server that lets a founder's Claude client recommend the right FUTURY mentor (shortlist of up to 3 with draft intros), list the mentor roster, and keep a local profile of the founder's questions.

**Architecture:** One stdio MCP server (`src/server.ts`) registers three tools. Pure logic (labels, matcher, intro) is separate from file I/O (mentor roster, founder profile). The profile is an append-only JSON array written with a per-process queue and temp-file-and-rename. A small CLI (`npm run report`) summarises the profile for the founder check-in.

**Tech Stack:** TypeScript (ESM, NodeNext), Node 24 LTS (22 supported), `@modelcontextprotocol/sdk` 1.x, `zod` 3.x, Vitest, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-03-founder-guidance-mcp-design.md` (commit 4513014). Read it alongside this plan; where they disagree, the spec wins and the plan gets fixed.

## Global Constraints

- Runtime: Node 24 LTS; `engines.node` is `>=22`; CI runs Node 22 and 24.
- Dependencies pinned to exact versions in `package.json`: `@modelcontextprotocol/sdk` (latest 1.x) and a `zod` 3.x the SDK accepts. No other runtime dependencies.
- MIT licence, no proprietary dependency, nothing from gstack or the gtm-plugin.
- stdout carries only MCP protocol messages; all logs go to stderr.
- Log lines name the tool, the error class and the file path or variable; never the founder's question, notes or key facts.
- `FUTURY_HOME` and `FUTURY_MENTORS_PATH` must be absolute; a relative value is an error naming the variable.
- Default `FUTURY_HOME` is `path.join(os.homedir(), ".futury")`; default roster is `data/mentors.json`, resolved via `import.meta.url`.
- Input limits: `question` and `notes` ≤ 500 characters; `key_facts` ≤ 10 items of ≤ 200 characters.
- Enum values and labels exactly as spec §5.5.
- All fixtures and demo data are invented; contact data uses `example.org`.
- `FUTURY_HOME` is created with mode 0700, `profile.json` with mode 0600.

## Review Focus

1. Notes containing line breaks or runs of spaces (pasted text): the draft intro should stay one clean sentence. Test in Task 3.
2. Non-ASCII text (German umlauts, emoji) in `question`, `notes` and mentor names: stored and returned unchanged. Tests in Task 3 and Task 5.
3. `FUTURY_HOME` pointing at an existing file instead of a folder: a clear error naming the path, no crash. Test in Task 5.
4. An empty (0-byte) mentor file after a botched roster swap: a clear "invalid JSON" error naming the path. Test in Task 4.
5. A long-running founder with thousands of profile entries: appends still work and stay fast. Test in Task 5 (5,000 entries).

## File structure

```
package.json, package-lock.json, tsconfig.json, vitest.config.ts   build and test config
.github/workflows/ci.yml                                         CI (Node 22 + 24)
LICENSE                                                          MIT
.gitignore                                                       + dist/, mentors.local.json
data/mentors.json                                                three invented demo mentors
src/labels.ts      enums, labels, input limits (pure, no I/O)
src/errors.ts      ConfigError, MentorFileError, ProfileFileError (declarations only)
src/matcher.ts     matchMentors: shortlist of up to 3 (pure)
src/intro.ts       buildIntro: draft intro text (pure)
src/mentors.ts     roster schema, path resolution, loadMentors (file I/O)
src/profile.ts     profile entry schema, resolveFuturyHome, ProfileStore (file I/O, queue)
src/server.ts      createServer + stdio entry point
src/report.ts      summarize + runReport CLI
test/helpers.ts    tempDir, connect, textOf, jsonOf, isRoot
test/*.test.ts     one test file per module, plus server.test.ts and smoke.test.ts
README.md          install, tools, routing snippet, roster swap, troubleshooting
```

`src/errors.ts` is the one file not named in the spec's unit list: it only declares the three error classes so storage and server share them without importing each other.

## Order and parallel lanes

```
Task 1 scaffold ─► Task 2 labels + server skeleton + EARLY HOST CHECK (gate)
                         ├─► Lane A: Task 3 matcher + intro
                         └─► Lane B: Task 4 mentors ─► Task 5 profile
                   merge ─► Task 6 server wiring + smoke test ─► Task 7 report ─► Task 8 README ─► Task 9 manual acceptance
```

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.github/workflows/ci.yml`, `LICENSE`
- Modify: `.gitignore` (add a build section above the "Local-only scaffold" section)

**Interfaces:**
- Consumes: nothing.
- Produces: `npm run build` (tsc → `dist/`), `npm test` (build, then Vitest), `npm run typecheck`, `npm run report`, `npm start`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "futury",
  "version": "0.1.0",
  "description": "Open-source MCP server that points founders to the right mentor from inside their AI client",
  "license": "MIT",
  "type": "module",
  "private": true,
  "engines": {
    "node": ">=22"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "npm run build && vitest run",
    "start": "node dist/server.js",
    "report": "node dist/report.js"
  }
}
```

- [ ] **Step 2: Install pinned dependencies**

Run:
```bash
npm install --save-exact @modelcontextprotocol/sdk@^1 zod@^3
npm install --save-dev --save-exact typescript@^5 vitest@^3 @types/node@^22
npm ls zod
```
Expected: `npm ls zod` shows a single `zod@3.x` used by both the project and the SDK. If the SDK pulls a second zod, install the zod version the SDK lists in `npm view @modelcontextprotocol/sdk@<installed version> dependencies peerDependencies` instead.

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "sourceMap": true
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    passWithNoTests: true,
    testTimeout: 15000,
  },
});
```

- [ ] **Step 5: Create `.github/workflows/ci.yml`**

```yaml
name: ci
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node: [22, 24]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
          cache: npm
      - run: npm ci
      - run: npm audit --omit=dev --audit-level=high
      - run: npm run typecheck
      - run: npm test
```

- [ ] **Step 6: Create `LICENSE`**

```
MIT License

Copyright (c) 2026 NojNo

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 7: Add build ignores to `.gitignore`**

Insert this block directly above the line `# --- Local-only scaffold and agent files ---` (that section must stay last):

```
# Build output and private rosters
dist/
mentors.local.json
```

- [ ] **Step 8: Verify the scaffold**

`src/` is still empty, so `tsc` has nothing to compile yet; typecheck and build start working in Task 2.
Run: `npx vitest run`
Expected: "No test files found, exiting with code 0" (passWithNoTests).

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .github/workflows/ci.yml LICENSE .gitignore
git commit -m "chore: scaffold TypeScript MCP project"
```

---

### Task 2: Labels, server skeleton with real schemas, early host check

This task builds the final tool schemas and descriptions with canned responses, then tries them in Claude Code and Claude Desktop before any storage work. **It ends with a gate:** if the host does not use the tools as intended, stop and revisit the tool contract with the user (first fallback: Codex's single `record_question` tool, see `~/.gstack/projects/NojNo-futury/main-codex-plan-challenge-20261003.md`).

**Files:**
- Create: `src/labels.ts`, `src/server.ts` (skeleton), `test/helpers.ts`, `test/labels.test.ts`, `test/server-schema.test.ts`

**Interfaces:**
- Produces (`src/labels.ts`):
  - `CATEGORIES: readonly ["fundraising","hiring","go_to_market","product","pivot_strategy","legal_cap_table","leadership_team","other"]`
  - `STAGES: readonly ["idea","pre_seed","seed","series_a_plus"]`
  - `type ChallengeCategory`, `type Stage`
  - `ChallengeCategorySchema`, `StageSchema` (zod enums)
  - `CATEGORY_LABELS: Record<ChallengeCategory, string>`
  - `STAGE_LABELS: Record<Stage, { withArticle: string; bare: string }>`
  - `MAX_TEXT = 500`, `MAX_FACTS = 10`, `MAX_FACT = 200`
- Produces (`src/server.ts`): `createServer(deps?: ServerDeps): McpServer`, `interface ServerDeps { env?: NodeJS.ProcessEnv; now?: () => Date; log?: (line: string) => void }`, `DESCRIPTIONS`, `VERSION`.
- Produces (`test/helpers.ts`): `tempDir(): Promise<string>`, `connect(server: McpServer): Promise<Client>`, `textOf(result): string`, `jsonOf<T>(result): T`, `isRoot: boolean`.

- [ ] **Step 1: Write the failing labels test** (`test/labels.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { CATEGORIES, CATEGORY_LABELS, STAGES, STAGE_LABELS } from "../src/labels.js";

describe("labels", () => {
  it("uses the exact category labels from spec §5.5", () => {
    expect(CATEGORY_LABELS).toEqual({
      fundraising: "fundraising",
      hiring: "hiring",
      go_to_market: "go-to-market",
      product: "product decisions",
      pivot_strategy: "a possible pivot",
      legal_cap_table: "legal and cap table questions",
      leadership_team: "leadership and team questions",
      other: "a question outside the usual topics",
    });
    expect(Object.keys(CATEGORY_LABELS)).toEqual([...CATEGORIES]);
  });

  it("uses the exact stage labels with and without article", () => {
    expect(STAGE_LABELS).toEqual({
      idea: { withArticle: "an idea-stage", bare: "idea-stage" },
      pre_seed: { withArticle: "a pre-seed", bare: "pre-seed" },
      seed: { withArticle: "a seed-stage", bare: "seed-stage" },
      series_a_plus: { withArticle: "a Series A or later", bare: "Series A or later" },
    });
    expect(Object.keys(STAGE_LABELS)).toEqual([...STAGES]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/labels.test.ts`
Expected: FAIL, cannot resolve `../src/labels.js`.

- [ ] **Step 3: Implement `src/labels.ts`**

```ts
import { z } from "zod";

export const CATEGORIES = [
  "fundraising",
  "hiring",
  "go_to_market",
  "product",
  "pivot_strategy",
  "legal_cap_table",
  "leadership_team",
  "other",
] as const;

export const STAGES = ["idea", "pre_seed", "seed", "series_a_plus"] as const;

export type ChallengeCategory = (typeof CATEGORIES)[number];
export type Stage = (typeof STAGES)[number];

export const ChallengeCategorySchema = z.enum(CATEGORIES);
export const StageSchema = z.enum(STAGES);

export const CATEGORY_LABELS: Record<ChallengeCategory, string> = {
  fundraising: "fundraising",
  hiring: "hiring",
  go_to_market: "go-to-market",
  product: "product decisions",
  pivot_strategy: "a possible pivot",
  legal_cap_table: "legal and cap table questions",
  leadership_team: "leadership and team questions",
  other: "a question outside the usual topics",
};

export const STAGE_LABELS: Record<Stage, { withArticle: string; bare: string }> = {
  idea: { withArticle: "an idea-stage", bare: "idea-stage" },
  pre_seed: { withArticle: "a pre-seed", bare: "pre-seed" },
  seed: { withArticle: "a seed-stage", bare: "seed-stage" },
  series_a_plus: { withArticle: "a Series A or later", bare: "Series A or later" },
};

export const MAX_TEXT = 500;
export const MAX_FACTS = 10;
export const MAX_FACT = 200;
```

- [ ] **Step 4: Run the labels test**

Run: `npx vitest run test/labels.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Create `test/helpers.ts`**

```ts
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "futury-test-"));
}

export async function connect(server: McpServer): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "futury-test", version: "0.0.0" });
  await client.connect(clientSide);
  return client;
}

export function textOf(result: unknown): string {
  const content = (result as { content: { type: string; text: string }[] }).content;
  return content[0]!.text;
}

export function jsonOf<T = Record<string, unknown>>(result: unknown): T {
  return JSON.parse(textOf(result)) as T;
}

export const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
```

- [ ] **Step 6: Write the failing schema test** (`test/server-schema.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { CATEGORIES, STAGES } from "../src/labels.js";
import { createServer } from "../src/server.js";
import { connect, textOf } from "./helpers.js";

type JsonSchema = {
  required?: string[];
  properties: Record<string, Record<string, unknown>>;
};

describe("tool schemas", () => {
  it("advertises types, required fields, limits and enums in tools/list", async () => {
    const client = await connect(createServer());
    const { tools } = await client.listTools();
    const byName = Object.fromEntries(tools.map((t) => [t.name, t.inputSchema as JsonSchema]));
    expect(Object.keys(byName).sort()).toEqual(["find_mentor", "list_mentors", "log_interaction"]);

    const log = byName.log_interaction!;
    expect([...(log.required ?? [])].sort()).toEqual(["question", "topic"]);
    expect(log.properties.question).toMatchObject({ type: "string", maxLength: 500 });
    expect(log.properties.topic!.enum).toEqual([...CATEGORIES]);
    expect(log.properties.stage_hint!.enum).toEqual([...STAGES]);
    expect(log.properties.key_facts).toMatchObject({
      type: "array",
      maxItems: 10,
      items: { type: "string", maxLength: 200 },
    });

    const find = byName.find_mentor!;
    expect(find.required).toEqual(["challenge_category"]);
    expect(find.properties.challenge_category!.enum).toEqual([...CATEGORIES]);
    expect(find.properties.stage!.enum).toEqual([...STAGES]);
    expect(find.properties.notes).toMatchObject({ type: "string", maxLength: 500 });

    const list = byName.list_mentors!;
    expect(list.required ?? []).toEqual([]);
    expect(list.properties.challenge_category!.enum).toEqual([...CATEGORIES]);
  });

  it.each([
    ["find_mentor", { challenge_category: "marketing" }, "challenge_category"],
    ["find_mentor", { challenge_category: "fundraising", notes: "x".repeat(501) }, "notes"],
    ["log_interaction", { question: "x".repeat(501), topic: "hiring" }, "question"],
    ["log_interaction", { question: "q", topic: "hiring", key_facts: Array(11).fill("f") }, "key_facts"],
    ["list_mentors", { challenge_category: "sales" }, "challenge_category"],
  ])("returns isError naming the field: %s %j", async (name, args, field) => {
    const client = await connect(createServer());
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(field);
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `npx vitest run test/server-schema.test.ts`
Expected: FAIL, cannot resolve `../src/server.js`.

- [ ] **Step 8: Implement the server skeleton** (`src/server.ts`, canned responses; Task 6 replaces the handlers)

```ts
#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ChallengeCategorySchema, MAX_FACT, MAX_FACTS, MAX_TEXT, StageSchema } from "./labels.js";

export const VERSION: string = (
  JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }
).version;

export const DESCRIPTIONS = {
  log_interaction:
    "Record a substantive question the founder is working on, so their local Futury profile builds up over time. " +
    "Call this once for every substantive founder question (fundraising, hiring, product, go-to-market, legal, team, pivots and similar), " +
    "whether you answer it yourself or also call find_mentor. Do not call it for small talk or greetings. " +
    "Write `question` as a short summary, pick the closest `topic`, and pass `stage_hint` and `key_facts` only when the conversation states them.",
  find_mentor:
    "Find FUTURY mentors for a question that needs human experience: high-stakes decisions or questions without a good generic answer, " +
    "such as fundraising strategy, term sheets, senior hires, pivots, cap table and legal structure, or co-founder conflict. " +
    "Do not call it for small or generic questions; answer those yourself. " +
    "Always pass `stage` when the conversation reveals the founder's current stage. " +
    'Write `notes` as one first-person sentence the founder could send, e.g. "I\'m deciding between two term sheets." ' +
    "The result is a ranked shortlist of up to 3 mentors. Pick the one whose `focus` best fits what the founder said, explain why in one sentence, and you may mention the others. " +
    "Show that candidate's `draft_intro` unchanged and ask the founder to fill in [your name] and [your startup]; rewrite or translate it only if the founder asks. " +
    "If `candidates` is empty, answer yourself and suggest contacting FUTURY directly.",
  list_mentors:
    "List the FUTURY mentors available to the founder, with what each one covers. " +
    "Call this when the founder asks which mentors exist, who could help with a topic, or what the mentors cover. " +
    "Pass `challenge_category` to filter by topic.",
} as const;

export interface ServerDeps {
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  log?: (line: string) => void;
}

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const ok = (value: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });

// Canned responses for the early host check; Task 6 replaces them with real handlers.
const FIXTURE_MENTORS = [
  {
    id: "m-001",
    name: "Mara Lindqvist",
    focus: "Built and sold a B2B SaaS company; raised from pre-seed to Series A",
    categories: ["fundraising", "go_to_market", "product", "pivot_strategy"],
    stages: ["idea", "pre_seed", "seed"],
    contact: { email: "mara@example.org", booking_url: "https://example.org/book/mara" },
  },
  {
    id: "m-002",
    name: "Jonas Albrecht",
    focus: "Startup lawyer for financing rounds, cap tables, ESOPs and employment contracts",
    categories: ["legal_cap_table", "fundraising", "hiring"],
    stages: ["pre_seed", "seed", "series_a_plus"],
    contact: { email: "jonas@example.org", booking_url: "https://example.org/book/jonas" },
  },
];

export function createServer(_deps: ServerDeps = {}): McpServer {
  const server = new McpServer({ name: "futury", version: VERSION });

  server.registerTool(
    "log_interaction",
    {
      title: "Log founder question",
      description: DESCRIPTIONS.log_interaction,
      inputSchema: {
        question: z.string().min(1).max(MAX_TEXT).describe("The founder's question in short form"),
        topic: ChallengeCategorySchema.describe("Closest topic of the question"),
        stage_hint: StageSchema.optional().describe("Founder's stage, only if the conversation states it"),
        key_facts: z
          .array(z.string().max(MAX_FACT))
          .max(MAX_FACTS)
          .optional()
          .describe('Short facts stated by the founder, e.g. "team of 3", "runway 6 months"'),
      },
    },
    async () => ok({ ok: true, entries: 1 }),
  );

  server.registerTool(
    "find_mentor",
    {
      title: "Find a FUTURY mentor",
      description: DESCRIPTIONS.find_mentor,
      inputSchema: {
        challenge_category: ChallengeCategorySchema.describe("Topic the founder needs help with"),
        stage: StageSchema.optional().describe("Founder's current stage, whenever the conversation reveals it"),
        notes: z.string().max(MAX_TEXT).optional().describe("One first-person sentence about the situation"),
      },
    },
    async () =>
      ok({
        candidates: FIXTURE_MENTORS.map((m) => ({
          mentor: { id: m.id, name: m.name, focus: m.focus, contact: m.contact },
          reason: `fundraising, seed-stage: ${m.focus}`,
          fallback_used: false,
          draft_intro: `Hi ${m.name},\n\nI'm [your name] from [your startup], a seed-stage founder in the FUTURY network. I'm reaching out about fundraising.\n\nI'm writing to you because of your background: ${m.focus}.\n\nWould you have time for a short call in the coming weeks?\n\nBest,\n[your name]`,
        })),
        profile_logged: true,
      }),
  );

  server.registerTool(
    "list_mentors",
    {
      title: "List FUTURY mentors",
      description: DESCRIPTIONS.list_mentors,
      inputSchema: {
        challenge_category: ChallengeCategorySchema.optional().describe("Only list mentors covering this topic"),
      },
    },
    async () => ok({ mentors: FIXTURE_MENTORS }),
  );

  return server;
}

async function main(): Promise<void> {
  process.stderr.write(`futury ${VERSION} (skeleton)\n`);
  await createServer().connect(new StdioServerTransport());
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`futury: fatal ${error instanceof Error ? error.name : "Error"}\n`);
    process.exit(1);
  });
}
```

- [ ] **Step 9: Run the schema test**

Run: `npx vitest run test/server-schema.test.ts`
Expected: PASS (1 + 5 tests). If the `isError` cases throw an `McpError` instead, the pinned SDK predates the isError behaviour (spec §8): upgrade to the latest 1.x and repeat; do not loosen the schemas.

- [ ] **Step 10: Commit**

```bash
git add src/labels.ts src/server.ts test/helpers.ts test/labels.test.ts test/server-schema.test.ts
git commit -m "feat: tool schemas and server skeleton for host check"
```

- [ ] **Step 11: Early host check (manual)**

Build and register the skeleton in Claude Code:
```bash
npm run build
claude mcp add futury-dev -e FUTURY_HOME="$HOME/.futury-dev" -- "$(which node)" "$PWD/dist/server.js"
```
For Claude Desktop add to its config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS), with absolute paths from `which node` and `pwd`:
```json
{
  "mcpServers": {
    "futury-dev": {
      "command": "/ABSOLUTE/PATH/TO/node",
      "args": ["/ABSOLUTE/PATH/TO/futury/dist/server.js"],
      "env": { "FUTURY_HOME": "/ABSOLUTE/PATH/TO/HOME/.futury-dev" }
    }
  }
}
```
In each client, in a fresh conversation, add this draft routing snippet to the project instructions (Claude Code: `CLAUDE.md` in an empty test folder; Desktop: a Project's instructions):
```
## Futury mentor routing
- Small or generic questions: answer directly.
- A blocker in building or shipping my own product: use the matching gstack skill if installed (/review, /qa, /ship, /cso).
- Questions that need human judgment or experience (fundraising strategy, senior hires, pivots, cap table, co-founder conflict): call find_mentor, then log_interaction.
- Every substantive question, whichever of the above answers it, also gets one log_interaction call. Skip small talk.
- If I ask which mentors exist, call list_mentors.
```
Ask these six questions and record, per client, which tools were called and with which arguments:

| # | Question | Expected |
|---|---|---|
| 1 | "Hi! Can you help me with something later?" | no tool |
| 2 | "How do I write a good cold email to a pilot customer?" | `log_interaction` (go_to_market), no `find_mentor` |
| 3 | "We're seed stage and have two term sheets with different liquidation preferences. Which should we take?" | `find_mentor` (fundraising or legal_cap_table, `stage: seed`) + `log_interaction`; Claude picks one candidate, says why, shows its intro unchanged and asks for name/startup |
| 4 | "My co-founder wants to pivot to hardware and I don't. How do we decide?" | `find_mentor` (pivot_strategy or leadership_team) + `log_interaction` |
| 5 | "Which mentors are there?" | `list_mentors` |
| 6 | "What is an ESOP, briefly?" | `log_interaction` allowed, no `find_mentor` |

- [ ] **Step 12: Gate**

Write the results into the "Host check log" section at the end of this plan and commit:
```bash
git add docs/superpowers/plans/2026-10-03-futury-v1-mcp.md
git commit -m "docs: record early host check results"
```
Continue to Tasks 3-5 only if, in both clients, questions 3-5 call the expected tools and question 1 calls none. If not, stop and bring the log to the user: the tool contract is revisited before anything else is built. These six questions never go into the Task 9 held-out set.

---

### Task 3 (Lane A): Matcher and intro

**Files:**
- Create: `src/matcher.ts`, `src/intro.ts`, `test/matcher.test.ts`, `test/intro.test.ts`

**Interfaces:**
- Consumes: `CATEGORY_LABELS`, `STAGE_LABELS`, `ChallengeCategory`, `Stage` from `src/labels.ts`.
- Produces (`src/matcher.ts`):
  - `interface MatchableMentor { id: string; name: string; focus: string; categories: readonly ChallengeCategory[]; stages: readonly Stage[] }`
  - `interface Candidate<M extends MatchableMentor> { mentor: M; reason: string; fallback_used: boolean }`
  - `SHORTLIST_SIZE = 3`
  - `matchMentors<M extends MatchableMentor>(category: ChallengeCategory, stage: Stage | null, mentors: readonly M[]): Candidate<M>[]`
  - `reasonFor(category: ChallengeCategory, matchedStage: Stage | null, focus: string): string`
- Produces (`src/intro.ts`):
  - `interface IntroInput { mentorName: string; mentorFocus: string; category: ChallengeCategory; stage: Stage | null; notes?: string }`
  - `buildIntro(input: IntroInput): string`

- [ ] **Step 1: Write the failing matcher test** (`test/matcher.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import type { ChallengeCategory, Stage } from "../src/labels.js";
import { matchMentors, reasonFor, SHORTLIST_SIZE } from "../src/matcher.js";

const mentor = (id: string, categories: ChallengeCategory[], stages: Stage[]) => ({
  id,
  name: `Name ${id}`,
  focus: `Focus ${id}`,
  categories,
  stages,
});

const ids = (list: { mentor: { id: string } }[]) => list.map((c) => c.mentor.id);

describe("matchMentors", () => {
  it("returns only mentors covering the category", () => {
    const roster = [mentor("a", ["fundraising"], ["seed"]), mentor("b", ["hiring"], ["seed"])];
    expect(ids(matchMentors("hiring", "seed", roster))).toEqual(["b"]);
  });

  it("returns an empty list when nobody covers the category", () => {
    expect(matchMentors("legal_cap_table", "seed", [mentor("a", ["fundraising"], ["seed"])])).toEqual([]);
  });

  it("ranks a stage match above a category-only match and flags the fallback", () => {
    const roster = [mentor("a", ["fundraising"], ["seed"]), mentor("b", ["fundraising"], ["pre_seed"])];
    const result = matchMentors("fundraising", "pre_seed", roster);
    expect(ids(result)).toEqual(["b", "a"]);
    expect(result.map((c) => c.fallback_used)).toEqual([false, true]);
  });

  it("never flags a fallback when the stage is unknown", () => {
    const result = matchMentors("fundraising", null, [mentor("a", ["fundraising"], ["seed"])]);
    expect(result[0]!.fallback_used).toBe(false);
    expect(result[0]!.reason).toBe("fundraising: Focus a");
  });

  it("formats the reason with the stage only when it matched", () => {
    const roster = [mentor("a", ["fundraising"], ["seed"]), mentor("b", ["fundraising"], [])];
    const [matched, fallback] = matchMentors("fundraising", "seed", roster);
    expect(matched!.reason).toBe("fundraising, seed-stage: Focus a");
    expect(fallback!.reason).toBe("fundraising: Focus b");
  });

  it("caps the shortlist at 3 in score-then-file order", () => {
    const roster = [
      mentor("a", ["fundraising"], []),
      mentor("b", ["fundraising"], ["seed"]),
      mentor("c", ["fundraising"], []),
      mentor("d", ["fundraising"], ["seed"]),
      mentor("e", ["fundraising"], []),
    ];
    expect(SHORTLIST_SIZE).toBe(3);
    expect(ids(matchMentors("fundraising", "seed", roster))).toEqual(["b", "d", "a"]);
  });

  it("returns fewer than 3 when fewer match", () => {
    expect(ids(matchMentors("fundraising", "seed", [mentor("a", ["fundraising"], ["seed"])]))).toEqual(["a"]);
  });

  it("includes 2 or 3 equally scored mentors", () => {
    const roster = [mentor("a", ["hiring"], ["seed"]), mentor("b", ["hiring"], ["seed"]), mentor("c", ["hiring"], ["seed"])];
    expect(ids(matchMentors("hiring", "seed", roster))).toEqual(["a", "b", "c"]);
  });

  it("drops the 4th of 4 equally scored mentors by file order (documented limit)", () => {
    const roster = ["a", "b", "c", "d"].map((id) => mentor(id, ["hiring"], ["seed"]));
    expect(ids(matchMentors("hiring", "seed", roster))).toEqual(["a", "b", "c"]);
  });
});

describe("reasonFor", () => {
  it("uses the category label and the bare stage label", () => {
    expect(reasonFor("legal_cap_table", "series_a_plus", "Startup lawyer")).toBe(
      "legal and cap table questions, Series A or later: Startup lawyer",
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/matcher.test.ts`
Expected: FAIL, cannot resolve `../src/matcher.js`.

- [ ] **Step 3: Implement `src/matcher.ts`**

```ts
import { CATEGORY_LABELS, STAGE_LABELS, type ChallengeCategory, type Stage } from "./labels.js";

export interface MatchableMentor {
  id: string;
  name: string;
  focus: string;
  categories: readonly ChallengeCategory[];
  stages: readonly Stage[];
}

export interface Candidate<M extends MatchableMentor> {
  mentor: M;
  reason: string;
  fallback_used: boolean;
}

export const SHORTLIST_SIZE = 3;

export function reasonFor(category: ChallengeCategory, matchedStage: Stage | null, focus: string): string {
  const label = CATEGORY_LABELS[category];
  return matchedStage === null ? `${label}: ${focus}` : `${label}, ${STAGE_LABELS[matchedStage].bare}: ${focus}`;
}

export function matchMentors<M extends MatchableMentor>(
  category: ChallengeCategory,
  stage: Stage | null,
  mentors: readonly M[],
): Candidate<M>[] {
  return mentors
    .filter((m) => m.categories.includes(category))
    .map((m) => {
      const stageMatch = stage !== null && m.stages.includes(stage);
      return { m, stageMatch, score: 2 + (stageMatch ? 1 : 0) };
    })
    .sort((a, b) => b.score - a.score) // Array.prototype.sort is stable: ties keep file order
    .slice(0, SHORTLIST_SIZE)
    .map(({ m, stageMatch }) => ({
      mentor: m,
      reason: reasonFor(category, stageMatch ? stage : null, m.focus),
      fallback_used: stage !== null && !stageMatch,
    }));
}
```

- [ ] **Step 4: Run the matcher test**

Run: `npx vitest run test/matcher.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Write the failing intro test** (`test/intro.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { buildIntro } from "../src/intro.js";

const base = {
  mentorName: "Ada Example",
  mentorFocus: "Raised three seed rounds",
  category: "fundraising" as const,
  stage: "seed" as const,
};

describe("buildIntro", () => {
  it("renders the full template", () => {
    expect(buildIntro({ ...base, notes: "I'm deciding between two term sheets" })).toBe(
      "Hi Ada Example,\n\n" +
        "I'm [your name] from [your startup], a seed-stage founder in the FUTURY network. " +
        "I'm reaching out about fundraising. I'm deciding between two term sheets.\n\n" +
        "I'm writing to you because of your background: Raised three seed rounds.\n\n" +
        "Would you have time for a short call in the coming weeks?\n\n" +
        "Best,\n[your name]",
    );
  });

  it("drops the stage when unknown", () => {
    expect(buildIntro({ ...base, stage: null })).toContain("from [your startup], a founder in the FUTURY network.");
  });

  it("uses 'an' for the idea stage", () => {
    expect(buildIntro({ ...base, stage: "idea" })).toContain("an idea-stage founder");
  });

  it.each([undefined, "", "   "])("leaves out absent or empty notes (%j)", (notes) => {
    expect(buildIntro({ ...base, notes })).toContain("I'm reaching out about fundraising.\n\n");
  });

  it("keeps existing end punctuation", () => {
    expect(buildIntro({ ...base, notes: "Should we raise now?" })).toContain("fundraising. Should we raise now?\n\n");
  });

  it("collapses line breaks and repeated spaces in notes", () => {
    expect(buildIntro({ ...base, notes: "We have  two offers\nand  little time" })).toContain(
      "fundraising. We have two offers and little time.\n\n",
    );
  });

  it("keeps non-ASCII text unchanged", () => {
    const intro = buildIntro({ ...base, mentorName: "Jürgen Müller", notes: "Wir brauchen Hilfe 🚀" });
    expect(intro).toContain("Hi Jürgen Müller,");
    expect(intro).toContain("Wir brauchen Hilfe 🚀.");
  });

  it("uses the plain label for every category", () => {
    expect(buildIntro({ ...base, category: "other" })).toContain("about a question outside the usual topics.");
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run test/intro.test.ts`
Expected: FAIL, cannot resolve `../src/intro.js`.

- [ ] **Step 7: Implement `src/intro.ts`**

```ts
import { CATEGORY_LABELS, STAGE_LABELS, type ChallengeCategory, type Stage } from "./labels.js";

export interface IntroInput {
  mentorName: string;
  mentorFocus: string;
  category: ChallengeCategory;
  stage: Stage | null;
  notes?: string;
}

function asSentence(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean === "") return "";
  return /[.!?]$/.test(clean) ? clean : `${clean}.`;
}

export function buildIntro(input: IntroInput): string {
  const who =
    input.stage === null
      ? "a founder in the FUTURY network"
      : `${STAGE_LABELS[input.stage].withArticle} founder in the FUTURY network`;
  const note = asSentence(input.notes ?? "");
  const opening = [
    `I'm [your name] from [your startup], ${who}.`,
    `I'm reaching out about ${CATEGORY_LABELS[input.category]}.`,
    ...(note === "" ? [] : [note]),
  ].join(" ");
  return [
    `Hi ${input.mentorName},`,
    opening,
    `I'm writing to you because of your background: ${asSentence(input.mentorFocus)}`,
    "Would you have time for a short call in the coming weeks?",
    "Best,\n[your name]",
  ].join("\n\n");
}
```

- [ ] **Step 8: Run both tests**

Run: `npx vitest run test/matcher.test.ts test/intro.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/matcher.ts src/intro.ts test/matcher.test.ts test/intro.test.ts
git commit -m "feat: mentor shortlist matcher and draft intro"
```

---

### Task 4 (Lane B): Errors, mentor roster and demo data

**Files:**
- Create: `src/errors.ts`, `src/mentors.ts`, `data/mentors.json`, `test/mentors.test.ts`

**Interfaces:**
- Consumes: `CATEGORIES`, `ChallengeCategorySchema`, `StageSchema` from `src/labels.ts`; `tempDir` from `test/helpers.ts`.
- Produces (`src/errors.ts`):
  - `class ConfigError extends Error { readonly variable: string }` — message `"<variable> must be an absolute path"`
  - `class MentorFileError extends Error { readonly path: string }` — message `"Mentor file <path>: <reason>"`
  - `class ProfileFileError extends Error { readonly path: string }` — message `"Profile file <path>: <reason>"`
- Produces (`src/mentors.ts`):
  - `MentorSchema`, `type Mentor = { id; name; focus; categories: ChallengeCategory[]; stages: Stage[]; contact: { email: string; booking_url?: string } }`
  - `defaultMentorsPath(): string`
  - `resolveMentorsPath(env?: NodeJS.ProcessEnv): string` (throws `ConfigError("FUTURY_MENTORS_PATH")`)
  - `loadMentors(path: string): Promise<Mentor[]>` (throws `MentorFileError`)

- [ ] **Step 1: Create `src/errors.ts`**

```ts
export class ConfigError extends Error {
  constructor(readonly variable: string) {
    super(`${variable} must be an absolute path`);
    this.name = "ConfigError";
  }
}

export class MentorFileError extends Error {
  constructor(readonly path: string, reason: string) {
    super(`Mentor file ${path}: ${reason}`);
    this.name = "MentorFileError";
  }
}

export class ProfileFileError extends Error {
  constructor(readonly path: string, reason: string) {
    super(`Profile file ${path}: ${reason}`);
    this.name = "ProfileFileError";
  }
}
```

- [ ] **Step 2: Write the failing roster test** (`test/mentors.test.ts`)

```ts
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError, MentorFileError } from "../src/errors.js";
import { CATEGORIES } from "../src/labels.js";
import { defaultMentorsPath, loadMentors, resolveMentorsPath } from "../src/mentors.js";
import { tempDir } from "./helpers.js";

const valid = {
  id: "t-1",
  name: "Test Mentor",
  focus: "Invented focus",
  categories: ["fundraising"],
  stages: ["seed"],
  contact: { email: "test@example.org" },
};

async function rosterFile(content: unknown): Promise<string> {
  const path = join(await tempDir(), "roster.json");
  await writeFile(path, typeof content === "string" ? content : JSON.stringify(content));
  return path;
}

describe("loadMentors", () => {
  it("loads a valid roster, booking_url optional and stages may be empty", async () => {
    const path = await rosterFile([valid, { ...valid, id: "t-2", stages: [] }]);
    const mentors = await loadMentors(path);
    expect(mentors.map((m) => m.id)).toEqual(["t-1", "t-2"]);
    expect(mentors[0]!.contact.booking_url).toBeUndefined();
  });

  it("loads an empty array", async () => {
    expect(await loadMentors(await rosterFile([]))).toEqual([]);
  });

  it("reports a missing file with its path", async () => {
    const path = join(await tempDir(), "nope.json");
    await expect(loadMentors(path)).rejects.toThrow(new MentorFileError(path, "not found"));
  });

  it.each([
    ["invalid JSON", "{not json"],
    ["an empty (0-byte) file", ""],
  ])("reports %s with its path", async (_label, content) => {
    const path = await rosterFile(content);
    await expect(loadMentors(path)).rejects.toThrow(new MentorFileError(path, "invalid JSON"));
  });

  it.each([
    ["empty id", { ...valid, id: "" }],
    ["missing name", { ...valid, name: undefined }],
    ["empty focus", { ...valid, focus: "" }],
    ["empty categories", { ...valid, categories: [] }],
    ["unknown category", { ...valid, categories: ["marketing"] }],
    ["unknown stage", { ...valid, stages: ["growth"] }],
    ["missing contact.email", { ...valid, contact: {} }],
    ["a top-level object", "OBJECT"],
  ])("rejects %s", async (_label, entry) => {
    const path = await rosterFile(entry === "OBJECT" ? { mentors: [valid] } : [entry]);
    await expect(loadMentors(path)).rejects.toBeInstanceOf(MentorFileError);
    await expect(loadMentors(path)).rejects.toThrow(path);
  });

  it("rejects duplicate ids", async () => {
    const path = await rosterFile([valid, valid]);
    await expect(loadMentors(path)).rejects.toThrow("duplicate id t-1");
  });

  it("sees an edit on the next call without caching", async () => {
    const path = await rosterFile([valid]);
    expect((await loadMentors(path)).length).toBe(1);
    await writeFile(path, JSON.stringify([valid, { ...valid, id: "t-2" }]));
    expect((await loadMentors(path)).length).toBe(2);
  });
});

describe("mentor paths", () => {
  it("resolves the default roster from the package, not the working directory", () => {
    const path = defaultMentorsPath();
    expect(isAbsolute(path)).toBe(true);
    expect(path.endsWith(join("data", "mentors.json"))).toBe(true);
    expect(existsSync(path)).toBe(true);
  });

  it("uses an absolute FUTURY_MENTORS_PATH and rejects a relative one", () => {
    expect(resolveMentorsPath({ FUTURY_MENTORS_PATH: "/abs/roster.json" })).toBe("/abs/roster.json");
    expect(resolveMentorsPath({})).toBe(defaultMentorsPath());
    expect(() => resolveMentorsPath({ FUTURY_MENTORS_PATH: "roster.json" })).toThrow(
      new ConfigError("FUTURY_MENTORS_PATH"),
    );
  });
});

describe("demo roster", () => {
  it("has three invented mentors covering all 8 categories", async () => {
    const mentors = await loadMentors(defaultMentorsPath());
    expect(mentors.map((m) => m.id)).toEqual(["m-001", "m-002", "m-003"]);
    expect(new Set(mentors.flatMap((m) => m.categories))).toEqual(new Set(CATEGORIES));
    for (const m of mentors) expect(m.contact.email.endsWith("@example.org")).toBe(true);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run test/mentors.test.ts`
Expected: FAIL, cannot resolve `../src/mentors.js`.

- [ ] **Step 4: Create `data/mentors.json`**

```json
[
  {
    "id": "m-001",
    "name": "Mara Lindqvist",
    "focus": "Built and sold a B2B SaaS company; raised from pre-seed to Series A",
    "categories": ["fundraising", "go_to_market", "product", "pivot_strategy"],
    "stages": ["idea", "pre_seed", "seed"],
    "contact": { "email": "mara@example.org", "booking_url": "https://example.org/book/mara" }
  },
  {
    "id": "m-002",
    "name": "Jonas Albrecht",
    "focus": "Startup lawyer for financing rounds, cap tables, ESOPs and employment contracts",
    "categories": ["legal_cap_table", "fundraising", "hiring"],
    "stages": ["pre_seed", "seed", "series_a_plus"],
    "contact": { "email": "jonas@example.org", "booking_url": "https://example.org/book/jonas" }
  },
  {
    "id": "m-003",
    "name": "Helena Brandt",
    "focus": "Long-time CEO of a large industrial company: industry knowledge, management, leadership and corporate sales",
    "categories": ["leadership_team", "hiring", "go_to_market", "other"],
    "stages": ["seed", "series_a_plus"],
    "contact": { "email": "helena@example.org", "booking_url": "https://example.org/book/helena" }
  }
]
```

- [ ] **Step 5: Implement `src/mentors.ts`**

```ts
import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { ConfigError, MentorFileError } from "./errors.js";
import { ChallengeCategorySchema, StageSchema } from "./labels.js";

export const MentorSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  focus: z.string().min(1),
  categories: z.array(ChallengeCategorySchema).min(1),
  stages: z.array(StageSchema),
  contact: z.object({
    email: z.string(),
    booking_url: z.string().optional(),
  }),
});

export type Mentor = z.infer<typeof MentorSchema>;

const RosterSchema = z.array(MentorSchema).superRefine((mentors, ctx) => {
  const seen = new Set<string>();
  for (const m of mentors) {
    if (seen.has(m.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate id ${m.id}` });
    seen.add(m.id);
  }
});

export function defaultMentorsPath(): string {
  return fileURLToPath(new URL("../data/mentors.json", import.meta.url));
}

export function resolveMentorsPath(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.FUTURY_MENTORS_PATH;
  if (value === undefined || value === "") return defaultMentorsPath();
  if (!isAbsolute(value)) throw new ConfigError("FUTURY_MENTORS_PATH");
  return value;
}

export async function loadMentors(path: string): Promise<Mentor[]> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "unknown";
    throw new MentorFileError(path, code === "ENOENT" ? "not found" : `cannot read (${code})`);
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new MentorFileError(path, "invalid JSON");
  }
  const parsed = RosterSchema.safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    const where = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    throw new MentorFileError(path, `invalid roster: ${where}${issue.message}`);
  }
  return parsed.data;
}
```

- [ ] **Step 6: Run the roster test**

Run: `npx vitest run test/mentors.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/errors.ts src/mentors.ts data/mentors.json test/mentors.test.ts
git commit -m "feat: mentor roster loading and demo roster"
```

---

### Task 5 (Lane B): Profile store

**Files:**
- Create: `src/profile.ts`, `test/profile.test.ts`

**Interfaces:**
- Consumes: `ProfileFileError`, `ConfigError` (`src/errors.ts`); `ChallengeCategorySchema`, `StageSchema`, `MAX_TEXT`, `MAX_FACTS`, `MAX_FACT`, `Stage`, `ChallengeCategory` (`src/labels.ts`); `tempDir`, `isRoot` (`test/helpers.ts`).
- Produces (`src/profile.ts`):
  - `InteractionEntrySchema`, `RecommendationEntrySchema`, `ProfileEntrySchema`, `type ProfileEntry`
  - `interface InteractionInput { question: string; topic: ChallengeCategory; stage_hint?: Stage; key_facts?: string[] }`
  - `interface RecommendationInput { challenge_category: ChallengeCategory; stage: Stage | null; candidates: { mentor_id: string; mentor_name: string }[] }`
  - `resolveFuturyHome(env?: NodeJS.ProcessEnv): string` (throws `ConfigError("FUTURY_HOME")`)
  - `class ProfileStore { constructor(home: string, now?: () => Date); readonly path: string; readIfExists(): Promise<ProfileEntry[] | null>; read(): Promise<ProfileEntry[]>; latestStage(): Promise<Stage | null>; appendInteraction(input: InteractionInput): Promise<number>; appendRecommendation(input: RecommendationInput): Promise<number> }` — append methods resolve to the total entry count and reject with `ProfileFileError`.

- [ ] **Step 1: Write the failing profile test** (`test/profile.test.ts`)

```ts
import { chmod, readdir, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError, ProfileFileError } from "../src/errors.js";
import { ProfileEntrySchema, ProfileStore, resolveFuturyHome } from "../src/profile.js";
import { isRoot, tempDir } from "./helpers.js";

const NOW = new Date("2026-10-03T10:00:00.000Z");
const clock = () => NOW;

async function store(): Promise<ProfileStore> {
  return new ProfileStore(join(await tempDir(), "home"), clock);
}

const interaction = { question: "How do we price our pilot?", topic: "go_to_market" as const };

describe("ProfileStore appends", () => {
  it("creates FUTURY_HOME (0700) and profile.json (0600) on the first write", async () => {
    const s = await store();
    expect(await s.appendInteraction(interaction)).toBe(1);
    expect((await stat(s.home)).mode & 0o777).toBe(0o700);
    expect((await stat(s.path)).mode & 0o777).toBe(0o600);
    expect(await s.read()).toEqual([
      { type: "interaction", v: 1, timestamp: NOW.toISOString(), ...interaction },
    ]);
  });

  it("appends interactions and recommendations, returning the total count", async () => {
    const s = await store();
    await s.appendInteraction({ ...interaction, stage_hint: "seed", key_facts: ["team of 3"] });
    const count = await s.appendRecommendation({
      challenge_category: "fundraising",
      stage: null,
      candidates: [{ mentor_id: "m-001", mentor_name: "Mara Lindqvist" }],
    });
    expect(count).toBe(2);
    for (const entry of await s.read()) expect(ProfileEntrySchema.safeParse(entry).success).toBe(true);
  });

  it("keeps non-ASCII text unchanged", async () => {
    const s = await store();
    await s.appendInteraction({ question: "Brauchen wir eine GmbH? 🚀", topic: "legal_cap_table" });
    expect((await s.read())[0]).toMatchObject({ question: "Brauchen wir eine GmbH? 🚀" });
  });

  it("lands all 20 parallel appends from one process", async () => {
    const home = join(await tempDir(), "home");
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => new ProfileStore(home, clock).appendInteraction({ ...interaction, question: `q${i}` })),
    );
    expect((await new ProfileStore(home, clock).read()).length).toBe(20);
  });

  it("appends quickly to a profile with 5,000 entries", async () => {
    const s = await store();
    await mkdir(s.home, { recursive: true });
    const existing = Array.from({ length: 5000 }, (_, i) => ({
      type: "interaction",
      v: 1,
      timestamp: NOW.toISOString(),
      question: `q${i}`,
      topic: "product",
    }));
    await writeFile(s.path, JSON.stringify(existing));
    const started = Date.now();
    expect(await s.appendInteraction(interaction)).toBe(5001);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("keeps unknown keys on disk", async () => {
    const s = await store();
    await mkdir(s.home, { recursive: true });
    await writeFile(s.path, JSON.stringify([{ type: "interaction", v: 1, timestamp: NOW.toISOString(), question: "q", topic: "hiring", extra: "kept" }]));
    await s.appendInteraction(interaction);
    expect(JSON.parse(await readFile(s.path, "utf8"))[0].extra).toBe("kept");
  });
});

describe("ProfileStore failures", () => {
  it.skipIf(isRoot)("leaves the original untouched and no temp file on a failed write, then recovers", async () => {
    const s = await store();
    await s.appendInteraction(interaction);
    const before = await readFile(s.path, "utf8");
    await chmod(s.home, 0o500);
    await expect(s.appendInteraction(interaction)).rejects.toBeInstanceOf(ProfileFileError);
    expect(await readFile(s.path, "utf8")).toBe(before);
    expect((await readdir(s.home)).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    await chmod(s.home, 0o700);
    expect(await s.appendInteraction(interaction)).toBe(2);
  });

  it.each([
    ["invalid JSON", "{oops"],
    ["a top-level object", JSON.stringify({ entries: [] })],
    ["a bad timestamp", JSON.stringify([{ type: "interaction", v: 1, timestamp: "yesterday", question: "q", topic: "hiring" }])],
    ["a missing required field", JSON.stringify([{ type: "interaction", v: 1, timestamp: NOW.toISOString(), topic: "hiring" }])],
    ["an unsupported version", JSON.stringify([{ type: "interaction", v: 2, timestamp: NOW.toISOString(), question: "q", topic: "hiring" }])],
    [
      "more than 3 candidates",
      JSON.stringify([
        {
          type: "recommendation",
          v: 1,
          timestamp: NOW.toISOString(),
          challenge_category: "hiring",
          stage: null,
          candidates: ["a", "b", "c", "d"].map((id) => ({ mentor_id: id, mentor_name: id })),
        },
      ]),
    ],
  ])("rejects a profile with %s and leaves it unchanged", async (_label, content) => {
    const s = await store();
    await mkdir(s.home, { recursive: true });
    await writeFile(s.path, content);
    await expect(s.appendInteraction(interaction)).rejects.toThrow(new ProfileFileError(s.path, content.startsWith("{oops") ? "invalid JSON" : "malformed entries"));
    expect(await readFile(s.path, "utf8")).toBe(content);
  });

  it("reports FUTURY_HOME pointing at a file", async () => {
    const file = join(await tempDir(), "not-a-dir");
    await writeFile(file, "x");
    const s = new ProfileStore(file, clock);
    await expect(s.appendInteraction(interaction)).rejects.toBeInstanceOf(ProfileFileError);
    await expect(s.appendInteraction(interaction)).rejects.toThrow(s.path);
  });
});

describe("ProfileStore reads", () => {
  it("returns null / empty / unknown stage for a missing profile", async () => {
    const s = await store();
    expect(await s.readIfExists()).toBeNull();
    expect(await s.read()).toEqual([]);
    expect(await s.latestStage()).toBeNull();
  });

  it("takes the latest stage from interaction entries only", async () => {
    const s = await store();
    await s.appendInteraction({ ...interaction, stage_hint: "pre_seed" });
    await s.appendInteraction(interaction);
    await s.appendRecommendation({ challenge_category: "fundraising", stage: "series_a_plus", candidates: [] });
    expect(await s.latestStage()).toBe("pre_seed");
  });
});

describe("resolveFuturyHome", () => {
  it("defaults to ~/.futury, accepts absolute and rejects relative paths", () => {
    expect(resolveFuturyHome({})).toBe(join(homedir(), ".futury"));
    expect(resolveFuturyHome({ FUTURY_HOME: "/abs/home" })).toBe("/abs/home");
    expect(() => resolveFuturyHome({ FUTURY_HOME: "rel/home" })).toThrow(new ConfigError("FUTURY_HOME"));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/profile.test.ts`
Expected: FAIL, cannot resolve `../src/profile.js`.

- [ ] **Step 3: Implement `src/profile.ts`**

```ts
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import { ConfigError, ProfileFileError } from "./errors.js";
import {
  ChallengeCategorySchema,
  MAX_FACT,
  MAX_FACTS,
  MAX_TEXT,
  StageSchema,
  type ChallengeCategory,
  type Stage,
} from "./labels.js";

const Timestamp = z.string().refine((s) => !Number.isNaN(Date.parse(s)), { message: "invalid timestamp" });

export const InteractionEntrySchema = z
  .object({
    type: z.literal("interaction"),
    v: z.literal(1),
    timestamp: Timestamp,
    question: z.string().max(MAX_TEXT),
    topic: ChallengeCategorySchema,
    stage_hint: StageSchema.optional(),
    key_facts: z.array(z.string().max(MAX_FACT)).max(MAX_FACTS).optional(),
  })
  .passthrough();

export const RecommendationEntrySchema = z
  .object({
    type: z.literal("recommendation"),
    v: z.literal(1),
    timestamp: Timestamp,
    challenge_category: ChallengeCategorySchema,
    stage: StageSchema.nullable(),
    candidates: z.array(z.object({ mentor_id: z.string(), mentor_name: z.string() })).max(3),
  })
  .passthrough();

export const ProfileEntrySchema = z.discriminatedUnion("type", [InteractionEntrySchema, RecommendationEntrySchema]);
const ProfileSchema = z.array(ProfileEntrySchema);

export type ProfileEntry = z.infer<typeof ProfileEntrySchema>;

export interface InteractionInput {
  question: string;
  topic: ChallengeCategory;
  stage_hint?: Stage;
  key_facts?: string[];
}

export interface RecommendationInput {
  challenge_category: ChallengeCategory;
  stage: Stage | null;
  candidates: { mentor_id: string; mentor_name: string }[];
}

export function resolveFuturyHome(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.FUTURY_HOME;
  if (value === undefined || value === "") return join(homedir(), ".futury");
  if (!isAbsolute(value)) throw new ConfigError("FUTURY_HOME");
  return value;
}

const errorCode = (error: unknown): string => (error as NodeJS.ErrnoException).code ?? "unknown";

// One write queue per profile path, shared by every ProfileStore in this process.
const queues = new Map<string, Promise<unknown>>();

export class ProfileStore {
  readonly path: string;

  constructor(
    readonly home: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.path = join(home, "profile.json");
  }

  async readIfExists(): Promise<ProfileEntry[] | null> {
    let raw: string;
    try {
      raw = await readFile(this.path, "utf8");
    } catch (error) {
      if (errorCode(error) === "ENOENT") return null;
      throw new ProfileFileError(this.path, `cannot read (${errorCode(error)})`);
    }
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new ProfileFileError(this.path, "invalid JSON");
    }
    const parsed = ProfileSchema.safeParse(data);
    if (!parsed.success) throw new ProfileFileError(this.path, "malformed entries");
    return parsed.data;
  }

  async read(): Promise<ProfileEntry[]> {
    return (await this.readIfExists()) ?? [];
  }

  async latestStage(): Promise<Stage | null> {
    const entries = await this.read();
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i]!;
      if (entry.type === "interaction" && entry.stage_hint !== undefined) return entry.stage_hint;
    }
    return null;
  }

  appendInteraction(input: InteractionInput): Promise<number> {
    return this.enqueue({
      type: "interaction",
      v: 1,
      timestamp: this.now().toISOString(),
      question: input.question,
      topic: input.topic,
      ...(input.stage_hint === undefined ? {} : { stage_hint: input.stage_hint }),
      ...(input.key_facts === undefined ? {} : { key_facts: input.key_facts }),
    });
  }

  appendRecommendation(input: RecommendationInput): Promise<number> {
    return this.enqueue({
      type: "recommendation",
      v: 1,
      timestamp: this.now().toISOString(),
      challenge_category: input.challenge_category,
      stage: input.stage,
      candidates: input.candidates,
    });
  }

  private enqueue(entry: ProfileEntry): Promise<number> {
    const previous = queues.get(this.path) ?? Promise.resolve();
    const run = previous.then(() => this.write(entry));
    queues.set(this.path, run.catch(() => undefined));
    return run;
  }

  private async write(entry: ProfileEntry): Promise<number> {
    const entries = await this.read();
    entries.push(ProfileEntrySchema.parse(entry));
    const tmp = `${this.path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    try {
      await mkdir(this.home, { recursive: true, mode: 0o700 });
      await writeFile(tmp, `${JSON.stringify(entries, null, 2)}\n`, { mode: 0o600 });
      await rename(tmp, this.path);
    } catch (error) {
      await rm(tmp, { force: true }).catch(() => undefined);
      throw new ProfileFileError(this.path, `cannot write (${errorCode(error)})`);
    }
    return entries.length;
  }
}
```

- [ ] **Step 4: Run the profile test**

Run: `npx vitest run test/profile.test.ts`
Expected: PASS (the failed-write test is skipped when run as root).

- [ ] **Step 5: Commit**

```bash
git add src/profile.ts test/profile.test.ts
git commit -m "feat: local founder profile store with write queue"
```

---

### Task 6: Server wiring, integration tests and stdio smoke test

Replaces the Task 2 canned handlers with the real ones. `test/server-schema.test.ts` from Task 2 must keep passing unchanged.

**Files:**
- Modify: `src/server.ts` (full replacement below)
- Create: `test/server.test.ts`, `test/smoke.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2-5 (`matchMentors`, `buildIntro`, `loadMentors`, `resolveMentorsPath`, `ProfileStore`, `resolveFuturyHome`, `CATEGORY_LABELS`, the three error classes, `tempDir`, `connect`, `jsonOf`, `textOf`, `isRoot`).
- Produces: final `createServer(deps?: ServerDeps): McpServer`; `dist/server.js` entry point logging `futury <version> home=<path|invalid (...)> mentors=<path|invalid (...)>` to stderr.

- [ ] **Step 1: Write the failing integration test** (`test/server.test.ts`)

```ts
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { connect, isRoot, jsonOf, tempDir, textOf } from "./helpers.js";

const NOW = new Date("2026-10-03T10:00:00.000Z");

const roster = [
  { id: "f-1", name: "Fia Alpha", focus: "Seed rounds", categories: ["fundraising"], stages: ["seed"], contact: { email: "fia@example.org" } },
  { id: "f-2", name: "Ole Beta", focus: "Pre-seed rounds", categories: ["fundraising"], stages: ["pre_seed"], contact: { email: "ole@example.org", booking_url: "https://example.org/book/ole" } },
  { id: "f-3", name: "Ida Gamma", focus: "Hiring", categories: ["hiring"], stages: [], contact: { email: "ida@example.org" } },
];

type Found = {
  candidates: { mentor: { id: string; name: string; contact: { email: string; booking_url?: string } }; reason: string; fallback_used: boolean; draft_intro: string }[];
  reason?: string;
  profile_logged: boolean;
  profile_error?: string;
};

async function setup(opts: { rosterContent?: string | null; envOverride?: Record<string, string> } = {}) {
  const dir = await tempDir();
  const home = join(dir, "home");
  const rosterPath = join(dir, "roster.json");
  if (opts.rosterContent !== null) await writeFile(rosterPath, opts.rosterContent ?? JSON.stringify(roster));
  const lines: string[] = [];
  const env = { FUTURY_HOME: home, FUTURY_MENTORS_PATH: rosterPath, ...opts.envOverride };
  const client = await connect(createServer({ env, now: () => NOW, log: (l) => lines.push(l) }));
  return { client, home, rosterPath, lines, profile: join(home, "profile.json") };
}

const call = (client: Awaited<ReturnType<typeof setup>>["client"], name: string, args: Record<string, unknown>) =>
  client.callTool({ name, arguments: args });

describe("find_mentor", () => {
  it("returns a ranked shortlist with intros and logs the recommendation", async () => {
    const { client, profile } = await setup();
    const found = jsonOf<Found>(await call(client, "find_mentor", { challenge_category: "fundraising", stage: "pre_seed", notes: "We have two offers" }));
    expect(found.candidates.map((c) => c.mentor.id)).toEqual(["f-2", "f-1"]);
    expect(found.candidates[0]!.reason).toBe("fundraising, pre-seed: Pre-seed rounds");
    expect(found.candidates[1]!.fallback_used).toBe(true);
    expect(found.candidates[0]!.draft_intro).toContain("Hi Ole Beta,");
    expect(found.candidates[0]!.draft_intro).toContain("a pre-seed founder in the FUTURY network. I'm reaching out about fundraising. We have two offers.");
    expect(found.candidates[0]!.mentor.contact.booking_url).toBe("https://example.org/book/ole");
    expect(found.profile_logged).toBe(true);
    const entries = JSON.parse(await readFile(profile, "utf8"));
    expect(entries).toEqual([
      {
        type: "recommendation",
        v: 1,
        timestamp: NOW.toISOString(),
        challenge_category: "fundraising",
        stage: "pre_seed",
        candidates: [
          { mentor_id: "f-2", mentor_name: "Ole Beta" },
          { mentor_id: "f-1", mentor_name: "Fia Alpha" },
        ],
      },
    ]);
  });

  it("returns an empty shortlist with a reason and still logs it", async () => {
    const { client, profile } = await setup();
    const found = jsonOf<Found>(await call(client, "find_mentor", { challenge_category: "legal_cap_table" }));
    expect(found).toEqual({ candidates: [], reason: "No mentor covers legal and cap table questions", profile_logged: true });
    expect(JSON.parse(await readFile(profile, "utf8"))[0].candidates).toEqual([]);
  });

  it("falls back to the profile's latest stage_hint", async () => {
    const { client } = await setup();
    await call(client, "log_interaction", { question: "q", topic: "fundraising", stage_hint: "seed" });
    const found = jsonOf<Found>(await call(client, "find_mentor", { challenge_category: "fundraising" }));
    expect(found.candidates[0]!.mentor.id).toBe("f-1");
  });

  it("uses an explicit stage over an older profile stage_hint", async () => {
    const { client } = await setup();
    await call(client, "log_interaction", { question: "q", topic: "fundraising", stage_hint: "pre_seed" });
    const found = jsonOf<Found>(await call(client, "find_mentor", { challenge_category: "fundraising", stage: "seed" }));
    expect(found.candidates[0]!.mentor.id).toBe("f-1");
  });

  it.each([
    ["missing", null],
    ["malformed", "{bad"],
  ])("returns a tool error for a %s mentor file and writes nothing", async (_label, content) => {
    const { client, rosterPath, profile } = await setup({ rosterContent: content });
    const result = await call(client, "find_mentor", { challenge_category: "fundraising" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(rosterPath);
    await expect(readFile(profile, "utf8")).rejects.toThrow();
  });

  it("rejects a relative FUTURY_MENTORS_PATH", async () => {
    const { client } = await setup({ envOverride: { FUTURY_MENTORS_PATH: "roster.json" } });
    const result = await call(client, "find_mentor", { challenge_category: "fundraising" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("FUTURY_MENTORS_PATH");
  });

  it("still returns candidates when the profile is malformed", async () => {
    const { client, home, profile } = await setup();
    await mkdir(home, { recursive: true });
    await writeFile(profile, "{bad");
    const found = jsonOf<Found>(await call(client, "find_mentor", { challenge_category: "fundraising" }));
    expect(found.candidates.length).toBe(2);
    expect(found.profile_logged).toBe(false);
    expect(found.profile_error).toContain(profile);
    expect(await readFile(profile, "utf8")).toBe("{bad");
  });

  it("still returns candidates when FUTURY_HOME is relative", async () => {
    const { client } = await setup({ envOverride: { FUTURY_HOME: "rel/home" } });
    const found = jsonOf<Found>(await call(client, "find_mentor", { challenge_category: "fundraising" }));
    expect(found.candidates.length).toBe(2);
    expect(found.profile_logged).toBe(false);
    expect(found.profile_error).toContain("FUTURY_HOME");
  });

});

describe.skipIf(isRoot)("find_mentor with file permission problems", () => {
  it.each([[{}], [{ stage: "seed" }]])("still returns candidates with an unreadable profile (%j)", async (extra) => {
    const { client, profile } = await setup();
    await call(client, "log_interaction", { question: "q", topic: "fundraising" });
    await chmod(profile, 0o000);
    const found = jsonOf<Found>(await call(client, "find_mentor", { challenge_category: "fundraising", ...extra }));
    expect(found.candidates.length).toBe(2);
    expect(found.profile_logged).toBe(false);
    await chmod(profile, 0o600);
  });

  it("still returns candidates when the profile folder is read-only", async () => {
    const { client, home } = await setup();
    await call(client, "log_interaction", { question: "q", topic: "fundraising" });
    await chmod(home, 0o500);
    const found = jsonOf<Found>(await call(client, "find_mentor", { challenge_category: "fundraising" }));
    expect(found.candidates.length).toBe(2);
    expect(found.profile_logged).toBe(false);
    await chmod(home, 0o700);
  });
});

describe("demo roster", () => {
  it.each([
    ["fundraising", "seed", ["m-001", "m-002"]],
    ["legal_cap_table", "seed", ["m-002"]],
    ["leadership_team", "seed", ["m-003"]],
  ])("%s at %s returns %j", async (category, stage, expected) => {
    const dir = await tempDir();
    const client = await connect(createServer({ env: { FUTURY_HOME: join(dir, "home") }, now: () => NOW, log: () => undefined }));
    const found = jsonOf<Found>(await client.callTool({ name: "find_mentor", arguments: { challenge_category: category, stage } }));
    expect(found.candidates.map((c) => c.mentor.id)).toEqual(expected);
  });
});

describe("log_interaction", () => {
  it("appends and returns the total count", async () => {
    const { client, profile } = await setup();
    expect(jsonOf(await call(client, "log_interaction", { question: "q1", topic: "hiring" }))).toEqual({ ok: true, entries: 1 });
    expect(jsonOf(await call(client, "log_interaction", { question: "q2", topic: "product", key_facts: ["team of 3"] }))).toEqual({ ok: true, entries: 2 });
    expect(JSON.parse(await readFile(profile, "utf8"))[1]).toMatchObject({ type: "interaction", v: 1, key_facts: ["team of 3"] });
  });

  it("works with a missing mentor file", async () => {
    const { client } = await setup({ rosterContent: null });
    const result = await call(client, "log_interaction", { question: "q", topic: "hiring" });
    expect(result.isError).toBeFalsy();
  });

  it("returns a tool error on a malformed profile and logs without founder text", async () => {
    const { client, home, profile, lines } = await setup();
    await mkdir(home, { recursive: true });
    await writeFile(profile, "{bad");
    const result = await call(client, "log_interaction", { question: "SECRET-PLAN-XYZ", topic: "hiring" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(profile);
    expect(lines.join("\n")).toContain("log_interaction");
    expect(lines.join("\n")).toContain(profile);
    expect(lines.join("\n")).not.toContain("SECRET-PLAN-XYZ");
  });

  it("rejects a relative FUTURY_HOME", async () => {
    const { client } = await setup({ envOverride: { FUTURY_HOME: "rel/home" } });
    const result = await call(client, "log_interaction", { question: "q", topic: "hiring" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("FUTURY_HOME");
  });
});

describe("list_mentors", () => {
  it("lists all mentors in file order, filters by category, and returns an empty list", async () => {
    const { client } = await setup();
    const all = jsonOf<{ mentors: { id: string }[] }>(await call(client, "list_mentors", {}));
    expect(all.mentors.map((m) => m.id)).toEqual(["f-1", "f-2", "f-3"]);
    const hiring = jsonOf<{ mentors: { id: string }[] }>(await call(client, "list_mentors", { challenge_category: "hiring" }));
    expect(hiring.mentors.map((m) => m.id)).toEqual(["f-3"]);
    const none = jsonOf<{ mentors: unknown[] }>(await call(client, "list_mentors", { challenge_category: "other" }));
    expect(none.mentors).toEqual([]);
  });

  it("returns a tool error for a missing mentor file", async () => {
    const { client, rosterPath } = await setup({ rosterContent: null });
    const result = await call(client, "list_mentors", {});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(rosterPath);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/server.test.ts`
Expected: FAIL (the canned handlers ignore the roster and write nothing).

- [ ] **Step 3: Replace `src/server.ts` with the real implementation**

```ts
#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ConfigError, MentorFileError, ProfileFileError } from "./errors.js";
import { buildIntro } from "./intro.js";
import {
  CATEGORY_LABELS,
  ChallengeCategorySchema,
  MAX_FACT,
  MAX_FACTS,
  MAX_TEXT,
  StageSchema,
  type Stage,
} from "./labels.js";
import { matchMentors } from "./matcher.js";
import { loadMentors, resolveMentorsPath } from "./mentors.js";
import { ProfileStore, resolveFuturyHome } from "./profile.js";

export const VERSION: string = (
  JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }
).version;

export const DESCRIPTIONS = {
  log_interaction:
    "Record a substantive question the founder is working on, so their local Futury profile builds up over time. " +
    "Call this once for every substantive founder question (fundraising, hiring, product, go-to-market, legal, team, pivots and similar), " +
    "whether you answer it yourself or also call find_mentor. Do not call it for small talk or greetings. " +
    "Write `question` as a short summary, pick the closest `topic`, and pass `stage_hint` and `key_facts` only when the conversation states them.",
  find_mentor:
    "Find FUTURY mentors for a question that needs human experience: high-stakes decisions or questions without a good generic answer, " +
    "such as fundraising strategy, term sheets, senior hires, pivots, cap table and legal structure, or co-founder conflict. " +
    "Do not call it for small or generic questions; answer those yourself. " +
    "Always pass `stage` when the conversation reveals the founder's current stage. " +
    'Write `notes` as one first-person sentence the founder could send, e.g. "I\'m deciding between two term sheets." ' +
    "The result is a ranked shortlist of up to 3 mentors. Pick the one whose `focus` best fits what the founder said, explain why in one sentence, and you may mention the others. " +
    "Show that candidate's `draft_intro` unchanged and ask the founder to fill in [your name] and [your startup]; rewrite or translate it only if the founder asks. " +
    "If `candidates` is empty, answer yourself and suggest contacting FUTURY directly.",
  list_mentors:
    "List the FUTURY mentors available to the founder, with what each one covers. " +
    "Call this when the founder asks which mentors exist, who could help with a topic, or what the mentors cover. " +
    "Pass `challenge_category` to filter by topic.",
} as const;

export interface ServerDeps {
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  log?: (line: string) => void;
}

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const ok = (value: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });
const fail = (text: string): ToolResult => ({ isError: true, content: [{ type: "text", text }] });

function where(error: unknown): string {
  if (error instanceof ConfigError) return error.variable;
  if (error instanceof MentorFileError || error instanceof ProfileFileError) return error.path;
  return "";
}

function logLine(tool: string, error: unknown): string {
  const name = error instanceof Error ? error.name : "UnknownError";
  return `futury: ${tool} ${name} ${where(error)}`.trimEnd();
}

async function guard(tool: string, log: (line: string) => void, run: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await run();
  } catch (error) {
    log(logLine(tool, error));
    if (error instanceof ConfigError || error instanceof MentorFileError || error instanceof ProfileFileError) {
      return fail(error.message);
    }
    return fail(`internal error in ${tool}`);
  }
}

export function createServer(deps: ServerDeps = {}): McpServer {
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((line: string) => void process.stderr.write(`${line}\n`));
  const profile = (): ProfileStore => new ProfileStore(resolveFuturyHome(env), now);
  const server = new McpServer({ name: "futury", version: VERSION });

  server.registerTool(
    "log_interaction",
    {
      title: "Log founder question",
      description: DESCRIPTIONS.log_interaction,
      inputSchema: {
        question: z.string().min(1).max(MAX_TEXT).describe("The founder's question in short form"),
        topic: ChallengeCategorySchema.describe("Closest topic of the question"),
        stage_hint: StageSchema.optional().describe("Founder's stage, only if the conversation states it"),
        key_facts: z
          .array(z.string().max(MAX_FACT))
          .max(MAX_FACTS)
          .optional()
          .describe('Short facts stated by the founder, e.g. "team of 3", "runway 6 months"'),
      },
    },
    (args) =>
      guard("log_interaction", log, async () => {
        const entries = await profile().appendInteraction(args);
        return ok({ ok: true, entries });
      }),
  );

  server.registerTool(
    "find_mentor",
    {
      title: "Find a FUTURY mentor",
      description: DESCRIPTIONS.find_mentor,
      inputSchema: {
        challenge_category: ChallengeCategorySchema.describe("Topic the founder needs help with"),
        stage: StageSchema.optional().describe("Founder's current stage, whenever the conversation reveals it"),
        notes: z.string().max(MAX_TEXT).optional().describe("One first-person sentence about the situation"),
      },
    },
    (args) =>
      guard("find_mentor", log, async () => {
        const mentors = await loadMentors(resolveMentorsPath(env));
        let stage: Stage | null = args.stage ?? null;
        if (stage === null) {
          try {
            stage = await profile().latestStage();
          } catch {
            stage = null;
          }
        }
        const matches = matchMentors(args.challenge_category, stage, mentors);
        const candidates = matches.map((c) => ({
          mentor: { id: c.mentor.id, name: c.mentor.name, focus: c.mentor.focus, contact: c.mentor.contact },
          reason: c.reason,
          fallback_used: c.fallback_used,
          draft_intro: buildIntro({
            mentorName: c.mentor.name,
            mentorFocus: c.mentor.focus,
            category: args.challenge_category,
            stage,
            notes: args.notes,
          }),
        }));
        let profileLogged = true;
        let profileError: string | undefined;
        try {
          await profile().appendRecommendation({
            challenge_category: args.challenge_category,
            stage,
            candidates: matches.map((c) => ({ mentor_id: c.mentor.id, mentor_name: c.mentor.name })),
          });
        } catch (error) {
          profileLogged = false;
          profileError = error instanceof Error ? error.message : "profile not written";
          log(logLine("find_mentor", error));
        }
        const body =
          candidates.length > 0
            ? { candidates }
            : { candidates: [], reason: `No mentor covers ${CATEGORY_LABELS[args.challenge_category]}` };
        return ok({
          ...body,
          profile_logged: profileLogged,
          ...(profileError === undefined ? {} : { profile_error: profileError }),
        });
      }),
  );

  server.registerTool(
    "list_mentors",
    {
      title: "List FUTURY mentors",
      description: DESCRIPTIONS.list_mentors,
      inputSchema: {
        challenge_category: ChallengeCategorySchema.optional().describe("Only list mentors covering this topic"),
      },
    },
    (args) =>
      guard("list_mentors", log, async () => {
        const mentors = await loadMentors(resolveMentorsPath(env));
        const category = args.challenge_category;
        const listed = category === undefined ? mentors : mentors.filter((m) => m.categories.includes(category));
        return ok({
          mentors: listed.map((m) => ({
            id: m.id,
            name: m.name,
            focus: m.focus,
            categories: m.categories,
            stages: m.stages,
            contact: m.contact,
          })),
        });
      }),
  );

  return server;
}

function describePath(resolve: () => string): string {
  try {
    return resolve();
  } catch (error) {
    return error instanceof ConfigError ? `invalid (${error.message})` : "invalid";
  }
}

async function main(): Promise<void> {
  const home = describePath(() => resolveFuturyHome(process.env));
  const mentors = describePath(() => resolveMentorsPath(process.env));
  process.stderr.write(`futury ${VERSION} home=${home} mentors=${mentors}\n`);
  await createServer().connect(new StdioServerTransport());
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`futury: fatal ${error instanceof Error ? error.name : "Error"}\n`);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run the server tests**

Run: `npx vitest run test/server.test.ts test/server-schema.test.ts`
Expected: PASS (unreadable/read-only cases skipped as root).

- [ ] **Step 5: Write the stdio smoke test** (`test/smoke.test.ts`)

```ts
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import { tempDir } from "./helpers.js";

const SERVER = resolve("dist/server.js");

describe("stdio smoke test", () => {
  it("starts from an unrelated directory, answers over stdio and keeps stdout protocol-only", async () => {
    if (!existsSync(SERVER)) throw new Error("dist/server.js missing: run `npm run build` (npm test does this)");
    const cwd = await tempDir();
    const child = spawn(process.execPath, [SERVER], {
      cwd,
      env: { ...process.env, FUTURY_HOME: join(cwd, "home"), FUTURY_MENTORS_PATH: "" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdoutLines: string[] = [];
    let stderr = "";
    let buffer = "";
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    const response = new Promise<Record<string, unknown>>((resolveResponse, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout; stderr: ${stderr}`)), 10000);
      child.stdout.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (line.trim() === "") continue;
          stdoutLines.push(line);
          const message = JSON.parse(line) as { id?: number };
          if (message.id === 2) {
            clearTimeout(timer);
            resolveResponse(message as Record<string, unknown>);
          }
        }
      });
    });
    const send = (message: unknown) => child.stdin.write(`${JSON.stringify(message)}\n`);
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "smoke", version: "0" } },
    });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "find_mentor", arguments: { challenge_category: "fundraising", stage: "seed" } } });

    const result = (await response).result as { content: { text: string }[] };
    child.kill();
    const found = JSON.parse(result.content[0]!.text) as { candidates: { mentor: { id: string } }[] };
    expect(found.candidates.map((c) => c.mentor.id)).toEqual(["m-001", "m-002"]);
    for (const line of stdoutLines) expect(JSON.parse(line)).toMatchObject({ jsonrpc: "2.0" });
    expect(stderr).toMatch(/^futury \S+ home=\S+ mentors=\S+data\/mentors\.json/m);
  });
});
```

- [ ] **Step 6: Run the full suite (build first)**

Run: `npm test`
Expected: PASS, including `test/smoke.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/server.ts test/server.test.ts test/smoke.test.ts
git commit -m "feat: wire tools to matcher, roster and profile"
```

---

### Task 7: Report CLI

**Files:**
- Create: `src/report.ts`, `test/report.test.ts`

**Interfaces:**
- Consumes: `ProfileStore`, `resolveFuturyHome`, `ProfileEntry` (`src/profile.ts`); `CATEGORY_LABELS` (`src/labels.ts`); `ConfigError`, `ProfileFileError` (`src/errors.ts`).
- Produces: `summarize(entries: readonly ProfileEntry[]): string`; `runReport(env: NodeJS.ProcessEnv, out: (text: string) => void): Promise<number>` (exit code); `dist/report.js` CLI.

- [ ] **Step 1: Write the failing report test** (`test/report.test.ts`)

```ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ProfileEntry } from "../src/profile.js";
import { runReport, summarize } from "../src/report.js";
import { tempDir } from "./helpers.js";

const ts = "2026-10-03T10:00:00.000Z";
const entries: ProfileEntry[] = [
  { type: "interaction", v: 1, timestamp: ts, question: "q1", topic: "fundraising" },
  { type: "interaction", v: 1, timestamp: ts, question: "q2", topic: "fundraising" },
  { type: "interaction", v: 1, timestamp: ts, question: "q3", topic: "hiring" },
  {
    type: "recommendation",
    v: 1,
    timestamp: ts,
    challenge_category: "fundraising",
    stage: "seed",
    candidates: [
      { mentor_id: "m-001", mentor_name: "Mara Lindqvist" },
      { mentor_id: "m-002", mentor_name: "Jonas Albrecht" },
    ],
  },
  { type: "recommendation", v: 1, timestamp: ts, challenge_category: "fundraising", stage: null, candidates: [{ mentor_id: "m-002", mentor_name: "Jonas Albrecht" }] },
  { type: "recommendation", v: 1, timestamp: ts, challenge_category: "other", stage: null, candidates: [] },
];

describe("summarize", () => {
  it("prints counts, mentors and topics in the spec order", () => {
    expect(summarize(entries)).toBe(
      [
        "Interactions: 3",
        "Recommendations: 3 (no match: 1)",
        "Mentors suggested:",
        "  Jonas Albrecht: 2",
        "  Mara Lindqvist: 1",
        "Topics:",
        "  fundraising: 2",
        "  hiring: 1",
      ].join("\n"),
    );
  });

  it("prints none for empty sections", () => {
    expect(summarize([])).toBe(
      ["Interactions: 0", "Recommendations: 0 (no match: 0)", "Mentors suggested: none", "Topics: none"].join("\n"),
    );
  });
});

describe("runReport", () => {
  it("prints No profile yet and exits 0 when there is no profile", async () => {
    const out: string[] = [];
    expect(await runReport({ FUTURY_HOME: join(await tempDir(), "home") }, (t) => out.push(t))).toBe(0);
    expect(out).toEqual(["No profile yet"]);
  });

  it("prints the summary for an existing profile", async () => {
    const home = join(await tempDir(), "home");
    await mkdir(home, { recursive: true });
    await writeFile(join(home, "profile.json"), JSON.stringify(entries));
    const out: string[] = [];
    expect(await runReport({ FUTURY_HOME: home }, (t) => out.push(t))).toBe(0);
    expect(out).toEqual([summarize(entries)]);
  });

  it("prints the path and exits 1 for a malformed profile, leaving it unchanged", async () => {
    const home = join(await tempDir(), "home");
    await mkdir(home, { recursive: true });
    const path = join(home, "profile.json");
    await writeFile(path, "{bad");
    const out: string[] = [];
    expect(await runReport({ FUTURY_HOME: home }, (t) => out.push(t))).toBe(1);
    expect(out.join("\n")).toContain(path);
    expect(await readFile(path, "utf8")).toBe("{bad");
  });

  it("exits 1 for a relative FUTURY_HOME", async () => {
    const out: string[] = [];
    expect(await runReport({ FUTURY_HOME: "rel" }, (t) => out.push(t))).toBe(1);
    expect(out.join("\n")).toContain("FUTURY_HOME");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/report.test.ts`
Expected: FAIL, cannot resolve `../src/report.js`.

- [ ] **Step 3: Implement `src/report.ts`**

```ts
#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { ConfigError, ProfileFileError } from "./errors.js";
import { CATEGORY_LABELS } from "./labels.js";
import { ProfileStore, resolveFuturyHome, type ProfileEntry } from "./profile.js";

function ranked(counts: Map<string, number>): [string, number][] {
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "en"));
}

function section(title: string, rows: [string, number][]): string {
  if (rows.length === 0) return `${title}: none`;
  return [`${title}:`, ...rows.map(([name, count]) => `  ${name}: ${count}`)].join("\n");
}

export function summarize(entries: readonly ProfileEntry[]): string {
  let interactions = 0;
  let recommendations = 0;
  let noMatch = 0;
  const mentors = new Map<string, number>();
  const topics = new Map<string, number>();
  for (const entry of entries) {
    if (entry.type === "interaction") {
      interactions++;
      const label = CATEGORY_LABELS[entry.topic];
      topics.set(label, (topics.get(label) ?? 0) + 1);
    } else {
      recommendations++;
      if (entry.candidates.length === 0) noMatch++;
      for (const c of entry.candidates) mentors.set(c.mentor_name, (mentors.get(c.mentor_name) ?? 0) + 1);
    }
  }
  return [
    `Interactions: ${interactions}`,
    `Recommendations: ${recommendations} (no match: ${noMatch})`,
    section("Mentors suggested", ranked(mentors)),
    section("Topics", ranked(topics)),
  ].join("\n");
}

export async function runReport(env: NodeJS.ProcessEnv, out: (text: string) => void): Promise<number> {
  try {
    const entries = await new ProfileStore(resolveFuturyHome(env)).readIfExists();
    if (entries === null) {
      out("No profile yet");
      return 0;
    }
    out(summarize(entries));
    return 0;
  } catch (error) {
    if (error instanceof ConfigError || error instanceof ProfileFileError) {
      out(error.message);
      return 1;
    }
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  runReport(process.env, (text) => console.log(text)).then((code) => {
    process.exitCode = code;
  });
}
```

- [ ] **Step 4: Run the report test and the CLI**

Run: `npx vitest run test/report.test.ts`
Expected: PASS.
Run: `npm run build && FUTURY_HOME="$(mktemp -d)/home" npm run report`
Expected: prints `No profile yet`.

- [ ] **Step 5: Commit**

```bash
git add src/report.ts test/report.test.ts
git commit -m "feat: profile report CLI for the founder check-in"
```

---

### Task 8: README

**Files:**
- Modify: `README.md` (replace the single heading)

**Interfaces:**
- Consumes: tool names and descriptions (Task 6), `npm run report` (Task 7), the routing snippet drafted in Task 2.

- [ ] **Step 1: Write `README.md`**

````markdown
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
````

- [ ] **Step 2: Verify the install path from a fresh clone**

Run (in a temp folder, with the commits from Tasks 1-7 pushed or using `git clone <local repo path>`):
```bash
git clone /path/to/local/futury /tmp/futury-readme-check && cd /tmp/futury-readme-check && npm install && npm run build && npm test
```
Expected: all commands succeed, following only the README.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README with install, routing snippet and roster swap"
```

---

### Task 9: Manual acceptance in Claude Code and Claude Desktop

No code. Uses the built server with the demo roster, registered as `futury` (README) with a fresh `FUTURY_HOME` (e.g. `/tmp/futury-acceptance`). Record results in the "Acceptance log" section at the end of this plan.

- [ ] **Step 1: Tuning set** (both clients, fresh conversation each, routing snippet installed)

| # | Question | Expected |
|---|---|---|
| 1 | "Can you summarise what a cap table is in two sentences?" | no `find_mentor` |
| 2 | "Give me a checklist for our first team offsite." | no `find_mentor` |
| 3 | "How long should a pitch deck be?" | no `find_mentor` |
| 4 | "Thanks, that's all for now!" | no tool |
| 5 | "What does ARR mean?" | no `find_mentor` |
| 6 | "We're pre-seed. An angel offers 150k at a 4M cap but wants a board seat. Should we accept?" | `find_mentor` (fundraising or legal_cap_table, `stage: pre_seed`) |
| 7 | "Should we hire a VP Sales before product-market fit? We're seed stage." | `find_mentor` (hiring, `stage: seed`) |
| 8 | "Our co-founder stopped pulling their weight and owns 40%. What now?" | `find_mentor` (legal_cap_table or leadership_team) |
| 9 | "Our B2B tool isn't selling; should we pivot to consumers?" | `find_mentor` (pivot_strategy) |
| 10 | "How do we sell into a large industrial company as a seed startup?" | `find_mentor` (go_to_market, `stage: seed`) |

At most 1 of 10 may be handled wrongly per client. More: reword `DESCRIPTIONS` in `src/server.ts` (keep `test/server-schema.test.ts` green), rebuild, repeat.

- [ ] **Step 2: Held-out set**

The builder writes 10 new questions now (5 generic, 5 mentor-worthy) that were never used in Task 2 or Step 1, and asks them in fresh sessions in both clients. Same limit: at most 1 of 10 wrong.

- [ ] **Step 3: Logging check**

Open `profile.json` in the acceptance `FUTURY_HOME` (or run `npm run report`). Each substantive question, including those answered without a mentor, has an `interaction` entry with a plausible `topic` and `stage_hint`; small talk has none. Note duplicates and misses; more than 1 miss in 10 means rewording `DESCRIPTIONS.log_interaction`.

- [ ] **Step 4: Awareness check**

Ask "Which mentors are there?" and "Who could help me with hiring?" Expected: `list_mentors` is called (with `challenge_category: hiring` for the second).

- [ ] **Step 5: Record and commit**

```bash
git add docs/superpowers/plans/2026-10-03-futury-v1-mcp.md
git commit -m "docs: record v1 acceptance results"
```

---

## Host check log

2026-10-03, Claude Code 2.1.288 headless in the sandbox (`claude -p --setting-sources project --disable-slash-commands --strict-mcp-config`, routing snippet via `--append-system-prompt-file`, model claude-opus-5, skeleton at 76055a9):

| # | Tools called | Pass |
|---|---|---|
| 1 | none | yes |
| 2 | log_interaction (go_to_market) | yes |
| 3 | find_mentor (fundraising, stage seed, first-person notes) + log_interaction (stage_hint seed, key_facts); picked one candidate with a reason, showed intro unchanged, asked for name/startup | yes |
| 4 | find_mentor (pivot_strategy) + log_interaction | yes |
| 5 | list_mentors | yes |
| 6 | log_interaction (legal_cap_table), no find_mentor | yes |

Gate: passed for Claude Code; tool contract unchanged. Claude Desktop not tested here (no GUI in the sandbox); it is covered in Task 9.

## Acceptance log

2026-10-03, Claude Code 2.1.288 headless in the sandbox (same flags as the host check, one fresh session per question, fresh `FUTURY_HOME`, real server at f122bfa):

- Tuning set: 10/10 correct. Q1-5 no `find_mentor` (Q4 no tool); Q6-10 `find_mentor` with the expected topic (fundraising/pre_seed, hiring/seed, leadership_team, pivot_strategy, go_to_market/seed). No description rewording needed, so the held-out set was not required (spec §10: only after rewording).
- Logging: 9/10 substantive questions logged; "What does ARR mean?" not logged (1 miss, within the limit); small talk none. `profile.json` mode 600, folder 700; `npm run report` output correct.
- Awareness: "Which mentors are there?" → `list_mentors`. "Who could help me with hiring?" → `find_mentor` (hiring) instead of `list_mentors`; it still surfaces the right mentors with intros. Noted, not counted as a failure.
- Sample answer (VP Sales question): picked Helena with a reason, explained why not Jonas, showed the intro with the founder's notes, gave contact and booking link.
- Claude Desktop: not tested (no GUI in the sandbox); open for the user.
