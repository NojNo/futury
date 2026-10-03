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
