# TODOS

Deferred from the v1 CEO review (2026-10-03). Each item is postponed, not
rejected. Spec: `docs/superpowers/specs/2026-10-03-founder-guidance-mcp-design.md`.

## Before the real-roster founder test

- **Gap feedback on no-match.** When no mentor covers the founder's topic,
  `find_mentor` returns a feedback draft addressed to a configured contact
  (e.g. `FUTURY_FEEDBACK_CONTACT`) naming the topic and stage, and logs the gap
  locally. Why: with 2-3 real mentors most topics are uncovered; without
  feedback, uncovered topics look like founders not following through, and
  nobody learns which mentors to recruit. Effort S.
- **"(found via Futury)" line in `draft_intro`.** Why: lets mentors confirm
  which intros came from the tool, so the founder-test pass count only counts
  intros Futury caused. Effort S.

## Later

- **German draft intro** (`FUTURY_LANG=de`). Why: FUTURY founders and mentors
  often write in German; today Claude translates only when asked. Add once the
  test founders' language is known. Effort S.
