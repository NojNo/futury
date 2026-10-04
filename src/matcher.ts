// SPDX-License-Identifier: Apache-2.0
import { CATEGORY_LABELS, STAGE_LABELS, type ChallengeCategory, type Stage } from "./labels.js";

export interface MatchableMentor {
  id: string;
  name: string;
  focus: string;
  categories: readonly ChallengeCategory[];
  stages: readonly Stage[];
}

export interface Candidate<M extends MatchableMentor> {
  mentor: M;
  reason: string;
  fallback_used: boolean;
}

export const SHORTLIST_SIZE = 3;

export function reasonFor(category: ChallengeCategory, matchedStage: Stage | null, focus: string): string {
  const label = CATEGORY_LABELS[category];
  return matchedStage === null ? `${label}: ${focus}` : `${label}, ${STAGE_LABELS[matchedStage].bare}: ${focus}`;
}

export function matchMentors<M extends MatchableMentor>(
  category: ChallengeCategory,
  stage: Stage | null,
  mentors: readonly M[],
): Candidate<M>[] {
  return mentors
    .filter((m) => m.categories.includes(category))
    .map((m) => ({ m, stageMatch: stage !== null && m.stages.includes(stage) }))
    .sort((a, b) => Number(b.stageMatch) - Number(a.stageMatch)) // stable sort: ties keep file order
    .slice(0, SHORTLIST_SIZE)
    .map(({ m, stageMatch }) => ({
      mentor: m,
      reason: reasonFor(category, stageMatch ? stage : null, m.focus),
      fallback_used: stage !== null && !stageMatch,
    }));
}
