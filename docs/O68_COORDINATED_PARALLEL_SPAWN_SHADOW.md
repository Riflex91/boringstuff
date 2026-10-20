# O68 – koordinierter Mehrfach-Spawn-Planer (SHADOW, noch keine Aktivierung)

Stand: 2026-10-20. Basis O67 (#414) auf O66 (#413) und O65 (#412).
Original Main: bc43f2faf1f345e63d9bfe78b6bbaa59e5eaab0c.

## Ziel und Begrenzung

Mehrere freie eigene Spawns desselben Raums sollen später unterschiedliche
benötigte Creeps gleichzeitig herstellen können. Eine zweite aktive
Spawn-Entscheidung ohne gemeinsame Rollen- und Energiebuchhaltung könnte
denselben Bedarf doppelt vergeben, doppelt Energie einplanen oder einen
Defender zugunsten eines optionalen Upgraders verlieren.

O68 liefert zuerst **einen rein lesenden, deterministischen
Planungsvorschlag**. Der einzige tatsächlich ausgeführte Spawn-Intent
bleibt unverändert der O66-Aufruf
\`spawnManager.spawnOne(state)\` in \`room.manager.js\`.
\`game/spawn.parallel.plan.js\` ruft kein \`spawnCreep\` auf, enthält
keine Spawn-/Game-/Memory-Mutationen und hat
\`actionAuthority:'NONE'\`. **Parallele produktive Aktionen sind noch
nicht implementiert, gemergt oder aktiviert.**

## Algorithmus

1. Validiert eigenen Controller, Zeit, Räume, Energiegrenzen,
   Eingabe-Array-Bounds, maximal 3 Raums-Spawns und maximal 256 lokale
   bzw. 1024 global beobachtete Creeps. Jede unklare oder doppelte
   Spawnidentität: HOLD.
2. Wählt nur unbeschäftigte, aktive, eigene und raumgleiche Spawns;
   sortiert stabil nach Namen. Laufende Jobs werden gegen
   \`Memory.creeps[jobName].role\` und Heimat geprüft. Unaufklärbarer
   Job: \`UNKNOWN_RUNNING_JOB\`, **keine** neue Reservierung.
3. Zählt aktive lokale Creeps, auswärtige Scouts desselben Heimat-
   raums und laufende Jobs ohne Doppelzählung. Berücksichtigt die
   bestehenden Prespawn-Horizonte und den optionalen dritten Upgrader.
4. Verwendet die bestehende Legacy-\`desired(state)\`-Bedarfslogik;
   bevorzugt reale Defender-Lücken, primäre Miner/Worker,
   Transport-Grundversorgung und kritische Reparatur vor voller
   Wirtschaftsproduktion und optionalem Ausbau.
5. Baut Körper mit dem unveränderten \`body.builder\`. Teilt bei
   mehreren fehlenden Rollen das verfügbare Raumenergiebudget
   deterministisch in Teilbudgets. Reserviert jede Körperkosten-Summe
   genau einmal, vermindert die simulierte Restenergie und erhöht die
   virtuelle Rollenzählung unmittelbar.
6. Unzureichende Energie für die nächste kritische Rolle:
   \`PARTIAL/CRITICAL_ROLE_ENERGY_SHORTFALL\` ohne Ausweichen
   auf einen optionalen Upgrader. Kein Rollback/Upload und kein
   Persistieren dieser nur simulierten Reservierung.
7. Veröffentlicht ausschließlich aggregierte Rollen/Kosten/Zähler in
   \`STATUS_SNAPSHOT.rooms[room].spawnParallel\` und im
   Raum-Heartbeat. Interne Pläne enthalten Spawnnamen zur
   deterministischen Zuordnung, werden **nicht** im öffentlichen
   Telemetriesnapshot serialisiert. CPU-Headroom-HOLD/deferred
   folgt dem vorhandenen Shadow-Stage-Gate.

## Nachweise und verbleibende Arbeiten

\`tools/o68-coordinated-parallel-spawn-plan.test.mjs\` simuliert
zwei frei wählbare Spawns, priorisierte Defender, laufende
Spawnaufträge, Rollen-/Energiededuplizierung, stabile Reihenfolge,
Niedrigenergie, ungültige Fremd-/Doppelspawns, 3-Spawn-Limit,
Eingabegrenzen, CPU-Deferred und fehlende Gameplay-Aktionen.
Die genaue CI des finalen Commits sowie P3 muss noch erfolgreich
abschließen. Die Review-Only-GitHub-Action verwendet **keine**
Screeps-Zugangsdaten und keine Deployment-Schreibbefehle.

Für spätere **produktive Parallelität** fehlen insbesondere ein
explizit releasefreigegebener Executor, atomare Tick-weite
Energiekontrolle über mehrere Spawn-Aufrufe, RC-/ERR_BUSY/
ERR_NOT_ENOUGH_ENERGY-Reconciliation, zusätzliche echte
Screeps-Laufzeitnachweise, Rollback-Gate und ein geregeltes
Main-/Server-Deployment. SHADOW-Vorschläge sind keine Freigabe.

Release weiterhin \`HOLD_EXACT_PREDECESSOR_PAIR_MISSING\`.
O68-Tests sind synthetisch; keine echten Game-Ticks und keine
Behauptung einer Live-Aktivierung. Vorherige O39–O64 Drafts
dürfen nicht allein wegen grüner Tests automatisch promoted werden.
