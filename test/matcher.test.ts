import { describe, expect, it } from "vitest";
import type { ChallengeCategory, Stage } from "../src/labels.js";
import { matchMentors, reasonFor, SHORTLIST_SIZE } from "../src/matcher.js";

const mentor = (id: string, categories: ChallengeCategory[], stages: Stage[]) => ({
  id,
  name: `Name ${id}`,
  focus: `Focus ${id}`,
  categories,
  stages,
});

const ids = (list: { mentor: { id: string } }[]) => list.map((c) => c.mentor.id);

describe("matchMentors", () => {
  it("returns only mentors covering the category", () => {
    const roster = [mentor("a", ["fundraising"], ["seed"]), mentor("b", ["hiring"], ["seed"])];
    expect(ids(matchMentors("hiring", "seed", roster))).toEqual(["b"]);
  });

  it("returns an empty list when nobody covers the category", () => {
    expect(matchMentors("legal_cap_table", "seed", [mentor("a", ["fundraising"], ["seed"])])).toEqual([]);
  });

  it("ranks a stage match above a category-only match and flags the fallback", () => {
    const roster = [mentor("a", ["fundraising"], ["seed"]), mentor("b", ["fundraising"], ["pre_seed"])];
    const result = matchMentors("fundraising", "pre_seed", roster);
    expect(ids(result)).toEqual(["b", "a"]);
    expect(result.map((c) => c.fallback_used)).toEqual([false, true]);
  });

  it("never flags a fallback when the stage is unknown", () => {
    const result = matchMentors("fundraising", null, [mentor("a", ["fundraising"], ["seed"])]);
    expect(result[0]!.fallback_used).toBe(false);
    expect(result[0]!.reason).toBe("fundraising: Focus a");
  });

  it("formats the reason with the stage only when it matched", () => {
    const roster = [mentor("a", ["fundraising"], ["seed"]), mentor("b", ["fundraising"], [])];
    const [matched, fallback] = matchMentors("fundraising", "seed", roster);
    expect(matched!.reason).toBe("fundraising, seed-stage: Focus a");
    expect(fallback!.reason).toBe("fundraising: Focus b");
  });

  it("caps the shortlist at 3 in score-then-file order", () => {
    const roster = [
      mentor("a", ["fundraising"], []),
      mentor("b", ["fundraising"], ["seed"]),
      mentor("c", ["fundraising"], []),
      mentor("d", ["fundraising"], ["seed"]),
      mentor("e", ["fundraising"], []),
    ];
    expect(SHORTLIST_SIZE).toBe(3);
    expect(ids(matchMentors("fundraising", "seed", roster))).toEqual(["b", "d", "a"]);
  });

  it("returns fewer than 3 when fewer match", () => {
    expect(ids(matchMentors("fundraising", "seed", [mentor("a", ["fundraising"], ["seed"])]))).toEqual(["a"]);
  });

  it("includes 2 or 3 equally scored mentors", () => {
    const roster = [mentor("a", ["hiring"], ["seed"]), mentor("b", ["hiring"], ["seed"]), mentor("c", ["hiring"], ["seed"])];
    expect(ids(matchMentors("hiring", "seed", roster))).toEqual(["a", "b", "c"]);
  });

  it("drops the 4th of 4 equally scored mentors by file order (documented limit)", () => {
    const roster = ["a", "b", "c", "d"].map((id) => mentor(id, ["hiring"], ["seed"]));
    expect(ids(matchMentors("hiring", "seed", roster))).toEqual(["a", "b", "c"]);
  });
});

describe("reasonFor", () => {
  it("uses the category label and the bare stage label", () => {
    expect(reasonFor("legal_cap_table", "series_a_plus", "Startup lawyer")).toBe(
      "legal and cap table questions, Series A or later: Startup lawyer",
    );
  });
});
