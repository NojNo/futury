# Roadmap: LLM-based profile building

Status: parked. Not part of v1.

v1 builds the founder profile from structured fields the host model fills in
when it calls `log_interaction`. The server stores them and does no inference.

This feature would have the server build the profile itself with its own LLM
call: extract stage, team size, runway, open problems and similar facts from
the raw interaction, merge them into a consolidated profile and keep the
history.

Questions for its own spec:

- Which provider, and how the open-source server stays provider-neutral.
- Cost and latency per call; sync or batched.
- How a consolidated profile is shaped compared with the v1 append-only log.
- Whether `find_mentor` uses the consolidated profile for matching.
- Privacy: founder text leaves the machine once a hosted model is involved.
