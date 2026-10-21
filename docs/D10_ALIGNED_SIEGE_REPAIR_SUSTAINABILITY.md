# D10 – Aligned Shield Attrition and Settled Repair Sustainability

Date: 2026-10-21. Exact D9 Main predecessor
`e23287dac2820057416b76098b92157669d10297`.

D9 release has successfully passed guarded Newbieland
[#39541928723](https://github.com/Riflex91/boringstuff/actions/runs/39541928723)
and World W37S79
[#39541928670](https://github.com/Riflex91/boringstuff/actions/runs/39541928670)
real-game 100-tick checks. A World diagnostics-only workflow can fail
independently from the successful protected live deploy.

## Objective / authenticated evidence

D8 `Room.getEventLog()` reports **engine-settled events for tick t-1**
while D9 compares **the identical owned core Rampart** in successive
actual game ticks `t-1 -> t`. D10 only correlates these **matching
observation times**; never substitutes accepted Tower/repair intents or
enemy damage estimates for settled outcome.

- D8 previous-tick `settledCoreShieldRepair`,
  `coreShieldRepairEvents`, `settledTowerDamage`,
  `settledTowerHealing` and `settledOwnedDamage` are accumulated into
  tick-local deltas only from a verified contiguous D8 100-tick window
  or exactly its first sample after window reset. Exact 100th-tick
  completion reads `lastCompletedWindow`; no rollover double counting.
- D9 per-current-tick shield-hit loss/gain is trusted **only** when
  `continuity=CONSECUTIVE`, authenticated live own Ramparts, and
  the source labels explicitly distinguish net hits vs damage
  potential. Shield net-hit loss is NOT synonymous with raw incoming
  damage; "repair receipts" are aggregated over all currently
  authenticated own-core Ramparts, not target-by-target matching.
- Max **12** consecutive aligned one-tick records across at most
  **three** owned rooms. Missing CPU reserve, event logs, stale D8
  receipt, unknown D9 shield identity, invalid/corrupted or skipped
  tick yields `GAP_UNKNOWN`, `STALE_OR_UNKNOWN` or `UNVERIFIED`;
  never a false safe or zero-repair conclusion.
- Diagnosis distinguishes:
  `CRITICAL_UNSHIELDED_CORE`,
  `CRITICAL_CORE_SHIELD_BREACH`,
  `SUSTAINED_ATTRITION_NO_OBSERVED_CORE_REPAIR` (three
  consecutive pressure/loss ticks, no settled repair recorded),
  `SUSTAINED_ATTRITION_WITH_REPAIR_EVIDENCE`,
  `SIEGE_TOWER_AMMO_SHORTFALL`,
  `SIEGE_DEFENDER_ABSENT`,
  `SIEGE_STORED_ENERGY_LOW`, and less severe pressure.
- Status data exposes only aggregate event totals, matched net
  Rampart-hit losses/gains, high-risk tick counts, ammunition,
  own defenders and energy. Never enemy names, object IDs or Creep
  identities. Optional warning for high-risk aligned outcomes is
  deduplicated and *purely informational*.
- Under CPU pressure the observer is skipped. It never issues
  `spawnCreep`, `attack`, `heal`, `repair`, `moveTo`,
  `activateSafeMode` or construction actions. D3 core-first active
  defense is always higher priority.

## Validation / limitations

`tools/d10-siege-sustainability-evidence.test.mjs` checks
authentic prior-tick D8 event vs current D9 shield delta alignment,
three consecutive observed repair-free attrition, evidence of repairs
while shields still lose hits, low Tower ammo, core exposure, threat,
missing event samples, reset recovery, 100-tick D8 window rollover,
full module integration, privacy and zero new gameplay authority.

The full Node24 regression suite and original P3 four-mode benchmark
must pass on exact PR head in secretless review and independent PR CI.
New Main then triggers separate guarded Newbieland/World uploads and
real-game 100-tick verifiers. A quiet environment cannot prove siege
survival; D10 cannot claim counterattack kills, prevent every defeat,
or identify causal repairs to the specific losing Rampart.
