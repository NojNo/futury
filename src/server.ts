#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
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
    const name = error instanceof Error ? error.name : "Error";
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`futury: fatal ${name}: ${message}\n`);
    process.exit(1);
  });
}
