# Contributing to futury

Thanks for helping. Issues and pull requests are welcome.

## Sign off your commits (DCO)

futury uses the [Developer Certificate of Origin](https://developercertificate.org/)
(DCO). By signing off a commit you certify that you wrote it, or otherwise have
the right to submit it, under the project's licence (Apache-2.0, see `LICENSE`).
If you contribute as part of your job, make sure your employer allows it.

Sign off by committing with `-s`:

```bash
git commit -s -m "feat: short description"
```

This adds a line with your name and the email of your git config:

```
Signed-off-by: Anna Example <anna@example.org>
```

The name and email must match the commit author. A check on every pull request
fails if any commit lacks the sign-off. To fix commits you already made:

```bash
git commit --amend -s --no-edit          # only the last commit
git rebase --signoff main                 # every commit on your branch
git push --force-with-lease
```

The sign-off is about where the code comes from. Review and the decision to
merge stay with the maintainer.

## How a change gets merged

1. Fork the repository and work on a branch in your fork.
2. Open a pull request against `main`. Keep it to one change; describe what
   and why, and how you tested it.
3. Checks run automatically: tests on Node 22 and 24, and the DCO sign-off.
   For first-time contributors a maintainer starts the checks by hand.
4. The maintainer reviews. Every change needs the maintainer's approval
   (`.github/CODEOWNERS`) and all review threads must be resolved.
5. The maintainer merges with a merge commit, so all your commits keep their
   history on `main` and the merge commit marks the pull request. `main`
   accepts no direct pushes; your branch is deleted after the merge.

Because every commit lands on `main`, keep commits meaningful: one logical
step each, with a clear message (e.g. `feat: ...`, `fix: ...`, `docs: ...`).

Bugs and ideas are welcome as issues first, especially for changes to a tool's
inputs or outputs.

## Development

Node.js 24 (22 also works).

```bash
npm install
npm run typecheck
npm test          # builds, then runs Vitest including a stdio smoke test
```

Every behaviour change comes with a test. The design lives in
`docs/superpowers/specs/`; read the relevant section before changing a tool's
contract.

## Data

Never commit real mentor or founder data. The repository only contains
invented example data (`example.org` contacts). Real rosters stay outside the
clone and are loaded via `FUTURY_MENTORS_PATH`.

## Security

Please report vulnerabilities privately, see `SECURITY.md`.
