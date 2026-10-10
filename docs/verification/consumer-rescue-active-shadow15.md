# Active consumer rescue — functional development candidate

**Status:** Draft only, not merged or deployed. Stacked on exact P3.1
commit `c5ef8c5a1fd2daa49793922771bf5d959c347fb8` from PR #117;
does **not** depend on diagnosis Drafts #123/#124.

## Gameplay change

A hauler with at least 25 energy, not yet at the legacy half-full
delivery threshold, can interrupt source collection to service a
consumer with at least 3 waiting-energy ticks or an active
`logisticsFallback` flag. This specifically targets the case where
consumers wait while some partial-load energy is already in transit.

This option exists **only** when all of these are true:

1. At least two live haulers and **exactly one** normally delivery-ready
   hauler. That normally ready hauler is explicitly excluded from
   consumer-guard selection while rescue is active, protecting one
   ready infrastructure carrier rather than merely one live carrier.
2. Room energy available equals positive room energy capacity. Every
   known spawn/extension has zero free energy capacity; every tower
   has at least half its energy capacity. Missing energy data, missing
   capacity or unavailable structure enumeration disables rescue.
3. An urgent delivery request exists that is not reserved by another
   hauler. A current legitimate reservation on the rescuer stays
   sticky; only one partial hauler is selected in a room, with
   deterministic range/name tie-breaking.
4. The rescuer has valid CARRY capacity, is not currently delivering
   and carries 25+ energy but less than its usual delivery threshold.

While rescue is selected, `role.hauler` calls the **existing**
`energy.deliverToConsumer` (existing movement, reservations, consumer
fallback clearing and transfer return-code handling). It does not set
`memory.delivering`, reduce body/spawn budgets, grant any E4 authority
or alter transfer API semantics. Every tick revalidates infrastructure
and guard conditions. If unsafe, it clears the consumer reservation
using the existing normal acquisition path; if a transfer is out of
range the existing `moveTo` call retains `PATH_MAX_OPS`.

No rescue occurs on a lone hauler, with no ready hauler, low/unknown
spawn energy, tower below 50%, already-reserved consumer, waiting less
than three ticks without fallback, or a partial haul below 25 energy.
When rescue is ineligible, legacy guard and hard infrastructure
delivery rules are unchanged.

## Risks / evidence

This is a behavior change, unlike previous diagnostic PRs.
Screeps `creep.transfer() === OK` is an accepted intent, **not**
confirmation of energy arriving after tick resolution. This proposal
does not change that existing legacy behavior. Offline fixtures test
selector behavior and issuing movement/transfer intents, not actual
live improvement or measured CPU consumption.

Functional gate: `tools/consumer-rescue.test.mjs` covers real
`role.hauler` decisions and key cancellation/reservation/safety
boundaries. Existing `consumer-supply.test.mjs` must also pass
unchanged. Node 24.21.0 canonical `npm test` and pinned `bench:p3`
must pass at exact candidate SHA. A future *separately authorized*
live deployment requires a new receipt and comparison of complete
100-tick fallback windows, actual hauler supply and infrastructure
emergencies before/after, and conservative rollback thresholds.

**Do not merge or deploy without direct user approval.**
