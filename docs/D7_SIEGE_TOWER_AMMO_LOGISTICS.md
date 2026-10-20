# D7 – Tower ammunition reserves under authentic enemy sieges

Staged from Main D6 `36a90b47535e0d5c1e82416448c38c3f5880dbf4`.
This is a separate REVIEW/NO-DEPLOY change while D6's own
exact-Main real-game verifications are in progress.

## Actual changes

1. Under an **observed living enemy ATTACK/RANGED_ATTACK/WORK/HEAL part**,
   a Hauler still prioritizes a needy owned Spawn first. A Tower below
   half energy then preempts extensions as before.
2. When the room has at least 80% of its current Spawn/Extension energy
   capacity available (and at least 300 available), Towers under 80%
   ammo may also be topped up before ordinary extensions. Otherwise
   the existing Spawn→Extension priority is preserved for moderately
   filled Towers. This avoids starving essential defender spawns.
3. While there is a genuine armed hostile and an owned Tower is below
   80% ammo, optional consumer starvation-guard Hauler diversion stops.
   Fully loaded Haulers remain available to the existing hard
   Spawn/Extension/Tower delivery path instead. Resumes automatically
   once all Towers recover to >=80% or armed hostiles leave.
   Unknown Tower-capacity under active siege suppresses diversion,
   but never authorizes speculative Tower refill over extensions.
4. Harmless scouts and disabled weapon parts do not activate D7.
   Rooms without Towers retain historic consumer behavior.
   D6 repair workers, Safe Mode and original Tower/defender logic remain.

## Evidence and limits

`tools/d7-siege-tower-ammo-logistics.test.mjs` checks Spawn-first
delivery, two Tower energy bands, economic reserve thresholds, active
enemy vs scout, consumer guard suspension/recovery, missing capacity
and no-Tower legacy path. The canonical Node24 suite and original
P3 benchmark are required in a branch-only secretless workflow.

D7 does **not** prove sustained siege victory or real-game energy
settlement. Pre-release synthetic behavior must not be mistaken for
a successful external hostile attack defense. No additional Creep
action API or direct Tower attack API is added.
