// SPDX-License-Identifier: Apache-2.0
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { absolutePathFromEnv, errorCode, ProfileFileError } from "./errors.js";
import {
  ChallengeCategorySchema,
  MAX_FACT,
  MAX_FACTS,
  MAX_TEXT,
  StageSchema,
  type ChallengeCategory,
  type Stage,
} from "./labels.js";

const EntryBase = {
  v: z.literal(1),
  timestamp: z.string().refine((s) => !Number.isNaN(Date.parse(s)), { message: "invalid timestamp" }),
};

export const InteractionEntrySchema = z
  .object({
    type: z.literal("interaction"),
    ...EntryBase,
    question: z.string().max(MAX_TEXT),
    topic: ChallengeCategorySchema,
    stage_hint: StageSchema.optional(),
    key_facts: z.array(z.string().max(MAX_FACT)).max(MAX_FACTS).optional(),
  })
  .passthrough();

export const RecommendationEntrySchema = z
  .object({
    type: z.literal("recommendation"),
    ...EntryBase,
    challenge_category: ChallengeCategorySchema,
    stage: StageSchema.nullable(),
    candidates: z.array(z.object({ mentor_id: z.string(), mentor_name: z.string() }).passthrough()).max(3),
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
  return absolutePathFromEnv(env, "FUTURY_HOME", () => join(homedir(), ".futury"));
}

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
