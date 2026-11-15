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
