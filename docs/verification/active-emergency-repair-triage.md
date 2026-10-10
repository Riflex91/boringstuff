# Active emergency repair triage — functional development

**Status:** candidate branch, never auto-deployed. Based on `main`
`1a895b2c4fe18fc524444042a9d6bf38ecc70230` (includes PR #125).

## Live behavior

The existing builder/worker/repairer `role.worker` behavior now scans visible
room structures for **owned spawns, towers and storage** under 35% health
(`hits / hitsMax < 0.35`). These are emergency repairs, in descending
importance: spawn, tower, storage. Roads, ramparts, walls, containers,
neutral/foreign structures, and invalid health reports are never promoted.
Within the highest priority tier, candidates are sorted by health ratio,
while the active worker path selects the closest reachable target using bounded
`PATH_MAX_OPS`; a `repair === ERR_NOT_IN_RANGE` result causes movement
with the existing bounded budget.

Every productive role except upgrader attempts emergency repairs **after**
its existing emergency-compatible `shouldAssistInfrastructure/refill`
check but before its ordinary build/repair work. Upgraders remain assigned
to the controller; defenders, miners and haulers remain unchanged.

When a critical structure exists, RCL2+ `spawn.manager` can create the
existing single dedicated `repairer` earlier in its spawn priority order,
ahead of the normal upgrader/builder workforce growth. It does so only after
the required base harvester and worker populations and a one-hauler
transport floor (when recommended by the legacy economy model) are live.
The existing emergency bootstrap mode and defender priority remain.
The existing damaged-structure demand threshold and MAX_REPAIRERS caps
are not increased. No new resources are created or spent other than the
existing standard repairer/repair behavior.

This is *active gameplay authority*, not shadow-only observation, but it
remains unmerged until CI passes. No extra CPU profiling/telemetry protocol
is introduced.

## Acceptance and limitations

- Dedicated fixture `tools/emergency-repair.test.mjs` verifies threat tier
  ordering, health boundary, ownership, noncritical build-first fallback,
  builder/worker/repairer action dispatch, upgrader continuity,
  route-budget preservation, no-path fallback, one-hauler infrastructure
  refill override, and actual spawn decision / essential crew floors.
- Canonical Node 24.21.0 `npm test` and P3 baseline benchmark run on the
  exact candidate SHA; existing tests remain required.
- The selected structure is **not** necessarily guaranteed to survive:
  this policy issues the real repair/move intent and only a live game can
  establish whether the repair landed and whether repair workers reached it.
- Normal repairs still use the established legacy filter/range choices;
  no walls/ramparts are automatically promoted by this emergency policy.
- Deployments require a distinct explicit user authorization. A GitHub
  merge does not update the Screeps server or the user's Windows collector.
