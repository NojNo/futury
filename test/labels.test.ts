import { describe, expect, it } from "vitest";
import { CATEGORIES, CATEGORY_LABELS, STAGES, STAGE_LABELS } from "../src/labels.js";

describe("labels", () => {
  it("uses the exact category labels from spec §5.5", () => {
    expect(CATEGORY_LABELS).toEqual({
      fundraising: "fundraising",
      hiring: "hiring",
      go_to_market: "go-to-market",
      product: "product decisions",
      pivot_strategy: "a possible pivot",
      legal_cap_table: "legal and cap table questions",
      leadership_team: "leadership and team questions",
      other: "a question outside the usual topics",
    });
    expect(Object.keys(CATEGORY_LABELS)).toEqual([...CATEGORIES]);
  });

  it("uses the exact stage labels with and without article", () => {
    expect(STAGE_LABELS).toEqual({
      idea: { withArticle: "an idea-stage", bare: "idea-stage" },
      pre_seed: { withArticle: "a pre-seed", bare: "pre-seed" },
      seed: { withArticle: "a seed-stage", bare: "seed-stage" },
      series_a_plus: { withArticle: "a Series A or later", bare: "Series A or later" },
    });
    expect(Object.keys(STAGE_LABELS)).toEqual([...STAGES]);
  });
});
