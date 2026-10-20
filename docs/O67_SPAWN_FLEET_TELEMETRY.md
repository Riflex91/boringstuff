# O67 – Raumbasierte Spawn-Flotten-Telemetrie (SHADOW)

Datum: 2026-10-20. Gameplay-Branch auf O66, der wiederum auf O65
aufbaut. Original Main bleibt
`bc43f2faf1f345e63d9bfe78b6bbaa59e5eaab0c`.

## Problem

Seit O66 darf `spawn.manager` einen zweiten oder dritten freien
eigenen Spawn desselben Raums auswählen. Die bisherigen
`STATUS_SNAPSHOT.rooms[room].spawnBusy` und
`spawnRemainingTime` zeigen jedoch weiterhin nur den *alten ersten*
`state.spawn`. O65 `spawnJobStall` wählt aus mehreren Spawns nur
einen Eintrag. Daraus könnte ein Beobachter fälschlich ableiten, dass
eine Kolonie insgesamt blockiert ist, obwohl ein anderer Spawn frei
ist – oder eine weitere Stall-Situation übersehen.

## Implementiert

Ein neues **rein beobachtendes**
`game/spawn.fleet.telemetry.js` erfasst pro Raum in einem
gegrenzten Durchlauf von höchstens 64 eigenen Spawns:

- `fleetSize` – im Raum gemeldete eigene Spawn-Objekte
- `busy` – aktuell mit einem Spawnauftrag belegte, aktive Spawns
- `idleAvailable` – freie, aktive, brauchbare eigene Spawns
- `inactive` – nicht aktive eigene Spawns
- `unknown` – fremde, raumfremde, doppelte oder defekte Einträge
- `allBusy` – alle validierten Spawns beschäftigt und keine unklaren
  oder inaktiven Einträge
- `hasIdleCapacity` – mindestens ein nach O66-Kriterien verwendbarer
  freier Spawn
- `suspectStalled`, `timerUnknown`,
  `maxContinuousJobTicks` und `trackedBusyJobs` –
  nur frische O65-Stallbeobachtungen des exakt gleichen Game-Ticks,
  Spawn-IDs und Spawnauftrags.

Fehlt der Beobachtungsnachweis oder hat zwischen Beobachtung und
Snapshot der Job gewechselt, bleiben die beweisabhängigen Zähler
UNKNOWN/NULL beziehungsweise `untrackedBusyJobs > 0` – niemals
ein erfundener positiver Entwarnungsnachweis. Der Status enthält keine
Spawn-, Creep- oder Jobnamen oder IDs und schreibt weder in Game noch
in Memory. Nur der bestehende O65-Observer verwaltet seine private,
begrenzte Historie.

`game/main.js` veröffentlicht unter
`STATUS_SNAPSHOT.rooms[room].spawnFleet` die neuen Daten.
Das alte `spawnBusy` bleibt **bewusst als primärer Spawn-Status**
unverändert, damit bestehende Auswertungen nicht stillschweigend ihre
Bedeutung wechseln. Neue Auswertungen sollten **`spawnFleet`**
nutzen. `spawnRemainingTime` bleibt ebenfalls primärbezogen.

## Testbelege

`tools/o67-spawn-fleet-telemetry.test.mjs` kombiniert den echten
O65-Observer mit der neuen O67-Aggregation und prüft:

- Spawn 1 belegt, Spawn 2 frei – roomweite freie Kapazität sichtbar;
- mindestens 151 gültige aufeinanderfolgende Game-Tick-Beobachtungen
  desselben O65-Auftrags zeigen den verdächtigen Job auch dann, wenn
  der erste Spawn in der Anzeigeliste frei ist;
- unpassende Jobidentitäten, fehlende alte/aktuelle Game-Ticks,
  nicht beobachtete laufende Jobs und ungültige Timer erzeugen keinen
  falschen sicheren Zustandsnachweis;
- alle Spawns beschäftigt, inaktiv, fehlerhaft, raumfremd,
  doppelter Eintrag sowie maximal 64 Mitglieder sind gesondert
  abgedeckt;
- weder Spawn-/Job-/Creep-Identitäten in öffentlichen
  Telemetriefeldern noch Spawnaktionen aus dem Beobachtungsmodul.

O67 ist ein **unmerged, nicht ausgerollter Gameplay-Draft-PR**
und kann den alten E8N1-Vorfall mit dessen ursprünglich nur einem
einzigen Spawn nicht rückwirkend auflösen.

## Freigabe

Kein `Spawn.cancel`, kein `spawnCreep` aus O67, kein Reset,
kein Remote-World-POST und keine Änderungen an Game-Konfiguration,
Body-Berechnung oder Combat-Intents. Der vollständige Node24-Testlauf
und die originalen P3-Benchmarks müssen vor Review bestehen.

**`HOLD_EXACT_PREDECESSOR_PAIR_MISSING`** bleibt bestehen:
Für World fehlt der originale `LIVE_100T_PASS` für den exakten
aktuellen Main SHA sowie das separat autorisierte sichere Deployment.
