import { CATEGORY_LABELS, STAGE_LABELS, type ChallengeCategory, type Stage } from "./labels.js";

export interface IntroInput {
  mentorName: string;
  mentorFocus: string;
  category: ChallengeCategory;
  stage: Stage | null;
  notes?: string;
}

function asSentence(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean === "") return "";
  return /[.!?]$/.test(clean) ? clean : `${clean}.`;
}

export function buildIntro(input: IntroInput): string {
  const who =
    input.stage === null
      ? "a founder in the FUTURY network"
      : `${STAGE_LABELS[input.stage].withArticle} founder in the FUTURY network`;
  const note = asSentence(input.notes ?? "");
  const opening = [
    `I'm [your name] from [your startup], ${who}.`,
    `I'm reaching out about ${CATEGORY_LABELS[input.category]}.`,
    ...(note === "" ? [] : [note]),
  ].join(" ");
  return [
    `Hi ${input.mentorName},`,
    opening,
    `I'm writing to you because of your background: ${asSentence(input.mentorFocus)}`,
    "Would you have time for a short call in the coming weeks?",
    "Best,\n[your name]",
  ].join("\n\n");
}
