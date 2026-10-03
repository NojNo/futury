import { z } from "zod";

export const CATEGORIES = [
  "fundraising",
  "hiring",
  "go_to_market",
  "product",
  "pivot_strategy",
  "legal_cap_table",
  "leadership_team",
  "other",
] as const;

export const STAGES = ["idea", "pre_seed", "seed", "series_a_plus"] as const;

export type ChallengeCategory = (typeof CATEGORIES)[number];
export type Stage = (typeof STAGES)[number];

export const ChallengeCategorySchema = z.enum(CATEGORIES);
export const StageSchema = z.enum(STAGES);

export const CATEGORY_LABELS: Record<ChallengeCategory, string> = {
  fundraising: "fundraising",
  hiring: "hiring",
  go_to_market: "go-to-market",
  product: "product decisions",
  pivot_strategy: "a possible pivot",
  legal_cap_table: "legal and cap table questions",
  leadership_team: "leadership and team questions",
  other: "a question outside the usual topics",
};

export const STAGE_LABELS: Record<Stage, { withArticle: string; bare: string }> = {
  idea: { withArticle: "an idea-stage", bare: "idea-stage" },
  pre_seed: { withArticle: "a pre-seed", bare: "pre-seed" },
  seed: { withArticle: "a seed-stage", bare: "seed-stage" },
  series_a_plus: { withArticle: "a Series A or later", bare: "Series A or later" },
};

export const MAX_TEXT = 500;
export const MAX_FACTS = 10;
export const MAX_FACT = 200;
