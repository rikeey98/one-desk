# terminal-tabs + agent-proposals (cycle 1) — Feature playbook

1. [x] `how` over the affected subsystem. (spec writers read the code; grounding in intents)
2. [x] `architect` for parallel design exploration. (lighter form: each spec compares >=2 structurally distinct shapes; full arena skipped — bounded design space, spec has a human gate)
3. [x] Write the throughput checkpoint as four todo items.
   - Blocking first steps: specs + plans written and reviewed
   - Independent workstreams: terminal-tabs and agent-proposals touch mostly disjoint files (shared: shared/channels.ts, shared/client.ts, electron/preload.ts, core/index.ts, App.tsx) -> serialize implementation, parallelize specs
   - Shared mutable state: shared IPC files -> one feature at a time on main checkout's branch
   - Smallest safe decomposition: one owner per feature, terminal-tabs first
4. [x] owners done; reviews + 6 fixes
5. [x] Verify on the matching surface.
6. [x] (ff-merged to main cf314f8) Rebase into small, ordered commits.
7. [x] (independent review per branch instead of interrogate) If the design is contested, `interrogate` before shipping.
8. [ ] Run **Opening a PR**. (skip: no gh, user lands on main per memory ui-work-preferences)
