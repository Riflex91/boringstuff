# Shadow.15 E4 exact late-window carrier

## Operator observations

The exact installed version 0.3.0-shadow.15-node24 on newbieland/chatgpt,
deployment ID 20261009200957502-9092, produced 100-tick General Live
window 3826000–3826099 with 13 PASS, 6 WATCH, 0 FAIL. Its E4 check
was WATCH because evidence was not for that exact window, not because
of a verified duplicate-reservation failure.

E4 uses its own 100-tick cadence. STATUS_SNAPSHOT has another cadence,
so an immutable finished E4 window may first appear in a later snapshot.

## Bounded, read-only verifier correction

Stacked strictly on the deployed P3.1 commit
c5ef8c5a1fd2daa49793922771bf5d959c347fb8, retaining the exact
version 0.3.0-shadow.15-node24.

A later E4 lastWindow is accepted only if all constraints hold:

- Carrier is a STATUS_SNAPSHOT with the explicitly declared exact requested bot version; missing version is rejected.
- Carrier tick is at or after window end, no more than 100 ticks later.
- E4 startTick/endTick exactly match the requested 100-tick window,
  and its ticks field equals exactly 100; contradictory 101-tick payloads are rejected.
- No intervening DEPLOYMENT_MARKER after the window end and through
  the carrier snapshot.
- The original in-window state shows E4 SHADOW available.

Only immutable E4 evidence is borrowed from that later carrier.
CPU, runtime errors, mining, supply, authority, collector health,
and every other current-state safety check still use only
the requested 100-tick window.

Missing duplicate-reservation counts remain WATCH; positive duplicate
reservation counts remain FAIL; missing critical coverage remains WATCH.

No game runtime JS module, version, activation, scheduler or CPU
threshold changes. No game upload or merge is performed.

## Tests and acceptance

Additional deterministic tests cover exact E4 late evidence PASS,
missing duplicate WATCH, positive duplicate FAIL, intervening deployment
marker WATCH, late-outside-bound WATCH, and unchanged in-window
safety checks.

CI uses Node 24.21.0 and the canonical test suite, plus the
existing P3 baseline benchmark. Do not infer an all-PASS live verdict
without choosing a true E4-aligned window in the retained logs.

A local-only verifier update from this stacked branch would require
the operator to act. Production merge or deployment still needs
separate authorization.
