import { describe, expect, it } from "vitest";
import { buildIntro } from "../src/intro.js";

const base = {
  mentorName: "Ada Example",
  mentorFocus: "Raised three seed rounds",
  category: "fundraising" as const,
  stage: "seed" as const,
};

describe("buildIntro", () => {
  it("renders the full template", () => {
    expect(buildIntro({ ...base, notes: "I'm deciding between two term sheets" })).toBe(
      "Hi Ada Example,\n\n" +
        "I'm [your name] from [your startup], a seed-stage founder in the FUTURY network. " +
        "I'm reaching out about fundraising. I'm deciding between two term sheets.\n\n" +
        "I'm writing to you because of your background: Raised three seed rounds.\n\n" +
        "Would you have time for a short call in the coming weeks?\n\n" +
        "Best,\n[your name]",
    );
  });

  it("drops the stage when unknown", () => {
    expect(buildIntro({ ...base, stage: null })).toContain("from [your startup], a founder in the FUTURY network.");
  });

  it("uses 'an' for the idea stage", () => {
    expect(buildIntro({ ...base, stage: "idea" })).toContain("an idea-stage founder");
  });

  it.each([undefined, "", "   "])("leaves out absent or empty notes (%j)", (notes) => {
    expect(buildIntro({ ...base, notes })).toContain("I'm reaching out about fundraising.\n\n");
  });

  it("keeps existing end punctuation", () => {
    expect(buildIntro({ ...base, notes: "Should we raise now?" })).toContain("fundraising. Should we raise now?\n\n");
  });

  it("collapses line breaks and repeated spaces in notes", () => {
    expect(buildIntro({ ...base, notes: "We have  two offers\nand  little time" })).toContain(
      "fundraising. We have two offers and little time.\n\n",
    );
  });

  it("keeps non-ASCII text unchanged", () => {
    const intro = buildIntro({ ...base, mentorName: "Jürgen Müller", notes: "Wir brauchen Hilfe 🚀" });
    expect(intro).toContain("Hi Jürgen Müller,");
    expect(intro).toContain("Wir brauchen Hilfe 🚀.");
  });

  it("uses the plain label for every category", () => {
    expect(buildIntro({ ...base, category: "other" })).toContain("about a question outside the usual topics.");
  });
});
