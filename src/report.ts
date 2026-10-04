#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { FuturyError } from "./errors.js";
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
    if (error instanceof FuturyError) {
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
