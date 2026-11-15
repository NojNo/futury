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
