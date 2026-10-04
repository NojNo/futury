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
