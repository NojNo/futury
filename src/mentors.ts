// SPDX-License-Identifier: Apache-2.0
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { absolutePathFromEnv, errorCode, MentorFileError } from "./errors.js";
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
  return absolutePathFromEnv(env, "FUTURY_MENTORS_PATH", defaultMentorsPath);
}

export async function loadMentors(path: string): Promise<Mentor[]> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    const code = errorCode(error);
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
