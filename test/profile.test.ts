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
