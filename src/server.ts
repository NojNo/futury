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
