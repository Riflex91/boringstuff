# D11 – Last-Second Owned Core Rampart Repairer Escalation

Exact verified D10 parent Main:
`d36321e151bddf49884604c171439f0bedc6973c`.
D10 guarded 100-real-tick releases on Newbieland
[#39553190861](https://github.com/Riflex91/boringstuff/actions/runs/39553190861)
and World W37S79
[#39553190768](https://github.com/Riflex91/boringstuff/actions/runs/39553190768)
both completed successfully.

## Observed code path

In the existing D6 `role.worker.run()`, `shouldAssistInfrastructure()`
causes an energy-carrying repairer to call `energy.deliver()` **before**
`emergencyRepair()` and `repairCoreShield()` if there is fewer than
two live Haulers. When one Hauler is still ready, this can pull the
dedicated repairer away even when a physically existing owned Rampart
directly over the Spawn or Tower is within three observed enemy-hit
equivalent ticks of losing all hits.

## Narrow productive D11 fix

- The work-priority module optionally accepts
  `{imminentOnly:true}`, filtering the **same previously verified**
  owned core-overlay Ramparts to at most **3 current active hostile
  weapon-damage equivalent ticks**. ATTACK, WORK and RANGED_ATTACK
  must actually be live and within their damage range. Existing D6
  threats beyond this threshold retain their original ranking.
- Only a Creep with exact role `repairer`, positive carried energy,
  an owned controller not currently protected by Safe Mode, and at
  least **one ready, non-spawning Hauler** may prioritize that
  shield before its own optional infrastructure energy delivery.
  This consumes the repairer's previously carried energy. It does
  **not** steal energy from a Spawn, Tower or Hauler.
- An owned Spawn/Tower/Storage already damaged below the existing
  35% emergency-health threshold retains higher priority in the
  existing ordinary D6 flow; D11 does not displace its critical
  repair decision or one-hauler infrastructure fallback.
- The last `worker`, any `builder` or `upgrader`, empty repairer,
  no live Hauler, foreign/remote shield, passive scout, destroyed
  enemy weapon, remote hostile, Safe Mode or moderate danger
  never authorizes the D11 bypass.
- After a successfully attempted repair (or a legitimate repair-range
  movement), the Creep returns for this tick. No competing delivery
  or construction action is attempted. Existing flee/evacuation
  before Creep role execution remains unchanged.

## Verification and limitations

`tools/d11-imminent-core-shield-repair.test.mjs` covers:
true core Rampart imminent breach, original workforce roles, zero
ready Haulers, still-spawning Hauler, beyond-three-tick risk, disabled
weapon and distant attacker, Safe Mode, critically damaged Spawn,
foreign/remote shield, empty Creep, out-of-range repair and
no double intent. Canonical Node24 suite and original P3 4-mode
benchmark run in exact-head secretless CI; only
`game/work.priority.js` and `game/role.worker.js` are modified.

No change to D8/D9/D10 risk observation, Safe Mode, Tower policy,
raid authority, parallel Spawn, expansion or stored-energy management.

A repair intent is not a settled increase in Rampart hits. Successful
CI and idle 100-real-tick release do not prove survival under a
coordinated siege. D8/D10 event evidence is necessary to quantify real
repair rates and compare them with real observed losses.
