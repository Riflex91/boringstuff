# O69 – Parallele Spawn-Intents hinter deaktiviertem Release-Gate

2026-10-20. Review-Branch auf O68 (#415), O67 (#414), O66 (#413),
O65 (#412). Keine Änderung an Main und keine Live-Ausführung.

## Lieferumfang

`game/spawn.parallel.execute.js` konsumiert einen O68-Plan nur dann,
wenn `config.ENABLE_PARALLEL_SPAWN_EXECUTION === true`.
**Der ausgelieferte Standard ist ausdrücklich `false`.**

Der Executor nimmt **keine** bloßen Telemetrieinformationen als
Freigabe: Er revalidiert Eigentum, Controller, gleichen Spiel-Tick,
Spawn-/Game-Objektidentität, Jobfreiheit, Body-Teile/Kosten, absolute
Raumenergie und die exakt gleiche reservierte Gesamtsumme.
Alle Spawn-Intents brauchen unterschiedliche Slots, eindeutige
Spawnnamen und konfliktfreie neue Creep-Namen.

Vor dem ersten echten Spawn-Intent berechnet der Executor zusätzlich
**einen frischen vollständigen O68-Plan**. Jede abweichende Rollenpriorität,
Spawn-Zuordnung, Körperzusammensetzung oder Energiereservierung führt zu
`PLAN_DRIFT` ohne produktiven Call. Der aktuelle Raum-Energiestand muss
exakt dem vorbereiteten Snapshot entsprechen. Nach den Dry-Runs wird die
Momentaufnahme erneut validiert. Eine Tick-lokale, im Prozess gehaltene
Raum-Sperre verhindert eine zweite produktive Ausführungsserie im gleichen
Spiel-Tick – auch wenn die erste Serie teilweise angenommen oder unklar
beantwortet wurde. Die Sperre prüft sowohl die echte Raumobjekt-Identität
als auch den `Game`-weiten Raumnamen für diesen Tick. Zusätzlich müssen
`state.room` exakt `Game.rooms[roomName]` und alle eingeplanten
Spawn-Objekte exakt diesem Raumobjekt zugeordnet sein; auch eine geänderte
Raum-Energiekapazität ist ein harter HOLD.

Vor dem ersten echten Spawn-Intent muss bei **jedem** reservierten
Kandidaten das offizielle `spawnCreep(...,{dryRun:true})` erfolgreich
sein. Erst danach werden höchstens drei produktive Anfragen
**sequentiell**, mit lokaler gemeinsam verminderter Energiebilanz,
abgegeben. Das ist Tick-weite Koordination, **keine atomare
Mehrfach-Spawn-Transaktion** des Screeps-Servers.
Jede Ablehnung oder unklare Antwort stoppt alle weiteren Versuche;
es gibt keinen Retry, kein `cancel()`, keine ungeprüfte
Memory-Creep-Bereinigung und keine automatische Rücksetzung
bereits akzeptierter Spawnaufträge.

In `room.manager` ist bei ausgeschaltetem Gate unverändert
der bestehende einzelne `spawnManager.spawnOne(state)` zuständig.
Wenn das Gate künftig **separat freigegeben und aktiviert** wird,
übernimmt ausschließlich der O69-Executor. Bei CPU-bedingtem
Planer-DEFERRED fällt der Raum fail-safe auf den bisherigen
einzelnen Spawn-Executor zurück; bei unklarer Planung folgt HOLD,
kein Spekulieren. Die Zusatztelemetrie
`spawnParallelExecution` bleibt getrennt vom nur modellierten
`spawnParallel`-Plan.

## Nachweise

`tools/o69-parallel-spawn-executor.test.mjs` prüft:
default-OFF = null Game-Requests; vorab erfolgreiche Dry-Runs;
zwei tatsächliche verschiedene Rollen/Spawns bei gemeinsamer Energie;
stale Energie und Tick; geänderte Spawnidentität/Busy-Status;
fehlende Eigentumsrechte; manipulierte Bodys und doppelte Slots;
vollständiger Abbruch bei fehlerhaftem Dry-Run und **kein Replay**
bei Fehler des zweiten produktiven Calls. Regelfall und Fehler sind
synthetische Screeps-API-Mocks, keine Live-Beweise.

Der Review-Only-Workflow enthält weder Screeps-Credentials noch
einen HTTP-POST- oder Deployment-Schritt und prüft den exakten
Commit mit Node24 und ursprünglichem P3-Benchmark.

## Offene Freigaben

- O65–O69 GitHub-Review/Merge-Kette, vorher O39–O64
  Sicherheits-/Uploader-Fixes einordnen und Konflikte prüfen.
- Echte Newbieland-/World-Laufzeit- und Rollbackbeweise, vor allem
  der fehlende original getaggte World-100T-Lauf zum exakten Main.
- Produktionsfreigabe für den schreibenden Executor und ggf. strengere
  Turn-Level-Reconciliation, insbesondere bei konkurrierenden
  Game-Intents und unsicheren HTTP-/Scheduler-Zuständen.
- Separat geprüfter kleiner Live-Rollout mit Überwachung tatsächlicher
  Spawnjobs, Energie, Rollenzahlen, Fehlerrückgaben und CPU.

**Release bleibt `HOLD_EXACT_PREDECESSOR_PAIR_MISSING`.**
Dieser PR ermöglicht keine vorgezogene Aktivierung, kein automatisches
World-/Newbieland-Deployment und keinen Main-Merge.
