# O70 – Reale Folgetick-Reconciliation für O69 Spawn-Aufträge (REVIEW ONLY)

Stand 2026-10-20. Gestapelter Branch auf O69 #416 → O68 #415.
Main, Newbieland und World bleiben unverändert; das aktivierbare
O69-Spawn-Gate ist weiterhin `ENABLE_PARALLEL_SPAWN_EXECUTION: false`.

## Ausgangslage und Korrektur

Ein `spawnCreep(...)`-Rückgabecode `OK` beweist nur, dass der
Screeps-Aufruf angenommen wurde. Er beweist **nicht**, dass der
entsprechende Spawn-Job im nächsten realen Spiel-Tick beobachtet wird.

O70 ergänzt `game/spawn.parallel.reconcile.js` mit einem kleinen
persistenten, **privaten** `Memory.bot.spawnParallelReconcile`-Ledger.
Der produktive O69-Executor (nur bei separat genehmigter Aktivierung)
speichert vor jedem produktiven Intent zuerst `SUBMITTED`, danach je
nach tatsächlichem Resultat `ACCEPTED`, `REJECTED` oder
`UNCERTAIN`. Schlägt die Speicherung vor dem Intent fehl, wird der
Intent **nicht** ausgeführt. Bereits teilweise akzeptierte Serien
werden nicht zurückgesetzt oder wiederholt. Pro Raum maximal drei
Einträge, maximal 16 Räume. Creep-/Spawn-Namen und Spawn-ID bleiben
ausschließlich im privaten Memory.

Der O70-Beobachter läuft im Hauptloop nach dem Memory-Bootstrap,
**vor dem Creep-Memory-Cleanup und vor produktiven Raumaufrufen**.
Er korreliert die Belege ausschließlich mit tatsächlichem
`Game.spawns[spawnName].spawning.name` bei korrekter Spawn-ID,
Eigentum und Raum oder mit einem echten passenden `Game.creeps`-Objekt.
`Memory.creeps` allein ist ausdrücklich **kein** Spawn-Beweis.
Bei einem fehlenden genau folgenden Tick entsteht `GAP_UNKNOWN`,
bei fehlendem Job `UNVERIFIED` statt eines behaupteten Engine-Bugs.
Ein mehrdeutiger Rückgabecode bleibt `UNCERTAIN`, sofern keine
echte In-Game-Beobachtung vorliegt. Bereits überprüfte Belege werden
entfernt, aggregierte Ergebnisse ohne Identitäten behalten.

**Zusätzliche Bugkorrektur:** `main.cleanupMemory()` bewahrt
`Memory.creeps[name]` für `Game.spawns[*].spawning.name` von
eigenen Spawns, selbst solange der neue Creep noch nicht in
`Game.creeps` sichtbar ist. Andernfalls kann eine laufende
Spawn-Order ihre Rollen-/Heimat-Memory vor der Fertigstellung verlieren
und der O68-Planer hält berechtigterweise mit
`UNKNOWN_RUNNING_JOB` an. Verwaiste Einträge werden weiterhin
entfernt; fremde Spawns verleihen keine Berechtigung.

## Offline-Nachweise

`tools/o70-spawn-intent-reconciliation.test.mjs`: persistierte
Belege nach simuliertem Global Reset, Folgetick-Verifizierung,
manipulationsresistente In-Game-Identität, Legacy-Memory ohne
Engine-Beleg, unsichere Rückgaben, Lücken, Bounds, fehlerhafte
Ledgers und exakte produktive Creep-Memory-Cleanup-Funktion.

`tools/o69-parallel-spawn-executor.test.mjs`: reale O69-Mock-Aufrufe
legen korrekte persistente Belege an und werden erst im nächsten
simulierten `Game.time` als beobachtete Jobs bewertet.

Die No-Deploy-CI führt Node24 `npm test` und den ursprünglichen
P3-Vier-Modi-Benchmark aus, ohne Screeps-Credentials oder HTTP-Writes.

## Freigabegrenzen

O70 ist **nur Diagnose**, keine automatische Reconciliation im Sinne
von Spawn-Neustart, Recovery-Command oder Spielfreigabe. Keine
`spawnCreep`-, `cancel`-, `renewCreep`-, `suicide`- oder
`createConstructionSite`-Aufrufe im Beobachter.

Insbesondere ersetzen synthetische 101-Tick-Tests keine realen,
exakten 100-Tick-World-Vorgängerbelege. Der operative Status bleibt
`HOLD_EXACT_PREDECESSOR_PAIR_MISSING`. Kein Main-Merge, World-Upload
oder Newbieland-Autodeployment aufgrund dieses Drafts.
