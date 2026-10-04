# Screeps Bot – Master Roadmap

Stand: 2026-10-04  
Server: Newbieland  
Projektziel: Ein autonomer, adaptiver, CPU-effizienter Screeps-Bot, der vom ersten Spawn bis zu einem vollständig entwickelten Drei-Raum-Empire selbstständig spielen, auf Angriffe reagieren, expandieren, Industrie und Markt betreiben und nach Verlusten recovern kann.

---

## 1. Aktueller Live-Stand

- Server: Newbieland Private Server
- Repository: `Riflex91/boringstuff`
- Kanonischer lokaler Arbeitsordner: `C:\Users\hansi\AppData\Local\Screeps\scripts\screeps_newbieland_net___21025\boringstuff`
- Installierter Runtime-Ordner: `C:\Users\hansi\AppData\Local\Screeps\scripts\screeps_newbieland_net___21025\chatgpt`
- Aktueller Raum: `E8N1`
- Spawn: `Spawn1`
- Runtime-Branch: `chatgpt`
- Letzte vollständig verifizierte Runtime-Version auf `main`: `0.2.19-node18`
- Aktueller Entwicklungs-Release: `0.2.20-node18` – **Critical Consumer Early Dispatch**
- Aktueller Entwicklungsbranch: `feature/v0.2.20-critical-consumer-early-dispatch`
- Aktueller PR: `#4` – Draft / erste Live-Iteration ausgewertet, zweite Behavior-Iteration muss neu verifiziert werden
- Colony Session: `E8N1-3669884`
- Aktuell erreicht: RCL2
- Node.js-Gate: exakt `18.20.4`
- CPU Bucket in den letzten verifizierten Fenstern: stabil / sicher
- Dedicated Mining im letzten verifizierten 100-Tick-Fenster: `20 e/t`
- Modellierter Hauler-Deficit: `0`
- v0.2.19 Live-Fenster `3684101–3684200`: `PASS=13 / WATCH=3 / FAIL=0`
- v0.2.19 Productive-Flow-Attribution:
  - `waitingRatio = 0.212`
  - `fallbackRatio = 0.097`
  - durchschnittliche Wartezeit bei wartenden Consumers: `5.73` Ticks
  - maximale Wartezeit: `12` Ticks
  - durchschnittliche Construction-Kapazität: `23.2 e/t`
  - tatsächlicher Construction-Durchsatz: `10.05 e/t`
  - Controller-Kapazität: `2 e/t`
  - tatsächlicher Controller-Durchsatz: `1.96 e/t`
- Aktuelle Hypothese: Der verbleibende Engpass ist primär **Delivery-Latenz**, nicht Mining- oder WORK-Kapazität.
- v0.2.20 testet daher Early Dispatch eines teilweise beladenen Haulers bei kritischem Consumer-Warten, ohne Hauler-Anzahl, Mining oder Single-Hauler-Recovery zu verändern.
- Erste v0.2.20 Live-Iteration, Fenster `3684501–3684600`: `PASS=13 / WATCH=4 / FAIL=0`.
  - `fallbackRatio = 0.008` gegenüber v0.2.19-Baseline `0.097`: stark verbessert.
  - `waitingRatio = 0.395` gegenüber Baseline `0.212`: deutlich verschlechtert.
  - Live-Logs bestätigen wartende/critical Consumers trotz bereits vorhandener Energie; Teil-Lieferungen beendeten Waiting bisher erst bei vollständig gefülltem Consumer.
  - Aktuelle zweite v0.2.20-Iteration: Jede erfolgreiche positive Consumer-Lieferung setzt `working=true`, löscht Waiting/Fallback und gibt die Reservation sofort frei.
  - Diese Behavior-Änderung ist noch **nicht live verifiziert** und erfordert erneut Offline-Test, Deploy, Smoke und 100-Tick-Live-Gate.
- `verify:live` wartet automatisch auf ein vollständiges 100-Tick-Fenster und zeigt einen Countdown `Waiting for data...[MM Min SS Sec remaining]`.
- Same-Version-Redeploy-Härtung: Jeder `npm run deploy` erhält künftig eine eindeutige `DEPLOYMENT_ID`; der erste Runtime-Tick schreibt einen persistenten `DEPLOYMENT_MARKER`. Smoke/Live-Verifikation richtet sich primär nach dem neuesten Deployment-Marker und fällt nur für historische Releases auf `VERSION_CHANGE` zurück.
- Die nach dem Partial-Delivery-Fix erneut ausgegebenen Fenster `3684422–3684446` und `3684501–3684600` waren **keine neue Verifikation**; sie wurden wegen des bisherigen Same-Version-Redeploy-Problems erneut ausgewählt. Diese Evidence bleibt historisch erhalten, zählt aber nicht als Validation der zweiten v0.2.20-Behavior-Iteration.
- Der neue Deployment-Marker ist live bestätigt: zweiter v0.2.20-Deploy startet bei Tick `3684877`; `verify:smoke` wählte korrekt `3684877–3684901`. Der erste Aufruf war lediglich zu früh und deshalb unvollständig. Smoke auto-wait wurde anschließend tools-only ergänzt; die laufende Live-Verifikation bleibt gültig.
- Zweite v0.2.20-Behavior-Iteration, erstes vollständiges Fenster `3684901–3685000`: `PASS=13 / WATCH=4 / FAIL=0`; `waitingRatio=0.113` gegenüber `0.212` verbessert, `fallbackRatio=0.228` gegenüber `0.097` verschlechtert. Behavior-Ziel damit **noch nicht erfüllt**. Da der Endzustand bereits wieder `fallback=0` zeigt, wird vor einem weiteren Codewechsel ein direkt anschließendes Steady-State-Kontrollfenster `3685001–3685100` ausgewertet, um Redeploy-/Memory-Transienten von einem dauerhaften State-Machine-Problem zu trennen.

Wichtig: Der Bot läuft live. Änderungen weiterhin datengetrieben durchführen. Historische Verification Evidence ist append-only und darf nicht nachträglich umgeschrieben werden.

---

## 2. Verbindliche Newbieland-Randbedingungen

### 2.1 Drei-Raum-Limit

Der Bot darf maximal drei eigene Räume gleichzeitig claimen.

Harte Invariante:

```text
ownedRooms >= 3
=> CLAIM_DISABLED
```

Diese Sperre muss unabhängig vom Strategy Layer gelten und auch bei Neustarts, Memory-Problemen, mehreren Expansion-Jobs oder Race Conditions verhindern, dass ein vierter Raum geclaimt wird.

### 2.2 Server-Reset

Nächster vollständiger Server-Reset:

```text
2027-02-01
```

Der Reset wird als großer End-to-End-Benchmark behandelt.

Der Entwicklungsstand darf nicht ausschließlich im Screeps-Memory liegen. Extern sichern:

- Source Code
- Konfigurationen
- Planner-Daten
- Algorithmen
- Benchmarks
- Telemetrie
- Build-/Deploy-Skripte
- wichtige strategische Erkenntnisse

### 2.3 Öffentliche Namen

Öffentlich sichtbare Namen neutral halten.

Keine öffentlichen Hinweise auf ChatGPT in:

- Spawn-Namen
- Creep-Namen
- Flags
- Controller Signs
- sonstigen öffentlich sichtbaren Spielobjekten

Interne Dateinamen oder lokale Entwicklungsstrukturen sind davon nicht betroffen.

---

## 3. Zielarchitektur

Der Bot soll langfristig nicht auf starren Rollenquoten basieren.

Nicht:

```text
Harvester macht immer X
Builder macht immer Y
Upgrader macht immer Z
```

Sondern:

```text
World / Colony State
        ↓
Bedarf und Probleme erkennen
        ↓
Strategische Prioritäten setzen
        ↓
Jobs erzeugen
        ↓
benötigte Arbeitskapazität berechnen
        ↓
Spawnbedarf bestimmen
        ↓
Creeps bauen und Jobs zuweisen
        ↓
Ergebnis messen
        ↓
Prioritäten neu bewerten
```

Die Colony-/Strategy-Ebene entscheidet, was benötigt wird. Creeps sind ausführende Worker.

---

## 4. Kernmodule

Langfristig soll die Architektur mindestens folgende Module besitzen:

```text
Empire Manager
├── Colony Manager
│   ├── Economy Manager
│   ├── Job Manager
│   ├── Spawn Manager
│   ├── Build / Planner Manager
│   ├── Logistics Manager
│   ├── Controller Manager
│   ├── Defense Manager
│   └── Recovery Manager
├── Intelligence Manager
├── Remote Manager
├── Expansion Manager
├── Combat Manager
├── Industry Manager
├── Market Manager
├── Strategy Manager
└── Telemetry / Health / Alert Layer
```

Die Module sollen über klar definierte Datenmodelle kommunizieren und nicht unnötig direkt voneinander abhängig sein.

---

# ENTWICKLUNGSPHASEN

## Phase 0 – Observability und Live-Benchmarking

Status: weit fortgeschritten; Live Verification Harness, Health, Efficiency, durable Telemetry und Productive-Flow-Attribution sind aktiv.

Ziele:

- strukturierte `BOTLOG`-Events
- `colonySessionId`
- `STATUS_SNAPSHOT`
- `bot-status-latest.json`
- Telemetrie-Historie
- CPU-Messung
- Spawn-Ereignisse
- Room Heartbeats
- Planner-Ereignisse
- Errors und Alerts
- Vorher/Nachher-Vergleiche

Noch verbessern:

- `[depth-limit]` in Status-Snapshots beseitigen
- echte Rollenanzahlen im strukturierten Snapshot
- Spawn-Auslastung über Zeitfenster
- Energiefluss-Metriken
- Source-Durchsatz
- Job-Queue
- Creep-TTL / Replacement-Risiko
- Build-Fortschritt
- Health Score
- Threat State
- Delta-Snapshots
- automatische Statusanalyse vorbereiten

Abschlusskriterium:

Der Zustand einer Colony kann aus Telemetrie rekonstruiert und objektiv bewertet werden.

---

## Phase 1 – RCL1 → RCL2 perfektionieren

Ziel:

Ein neuer Spawn baut möglichst schnell und zuverlässig eine funktionierende Economy auf.

Umsetzen:

- garantiertes Recovery-Verhalten bei 0 Creeps
- Emergency-Harvester
- sinnvolle Bootstrap-Spawnreihenfolge
- direkte Spawn-/Extension-Versorgung vor Container-Infrastruktur
- Worker früh genug erzeugen
- zusätzliche Harvester nur bei realem Bedarf
- Upgrading erst bei ausreichender Economy
- Energie nicht unnötig droppen
- Spawn nicht unnötig idle lassen
- Replacement kritischer Creeps priorisieren

Messen:

- Ticks bis erster Creep
- Ticks bis stabile Spawnversorgung
- Ticks bis erster Worker
- Ticks bis erster Upgrader
- Ticks bis RCL2
- Energie pro Tick
- Spawn-Auslastung
- Energieverlust
- CPU pro Tick

Abschlusskriterium:

RCL1 → RCL2 läuft schnell, reproduzierbar und ohne manuelle Eingriffe.

---

## Phase 2 – Dynamic Economy Manager

Ziel:

Feste Rollenquoten durch eine bedarfsgesteuerte Wirtschaft ersetzen.

Der Bot berechnet pro Source:

- maximale Produktion
- tatsächliche Harvest-Kapazität
- Transportdistanz
- Transportkapazität
- tatsächlichen Energiedurchsatz
- Verlust
- Source Downtime

Beispiel:

```text
Source output:       10 energy/tick
Mining throughput:   9.8 energy/tick
Transport throughput 6.5 energy/tick

=> Bottleneck = Logistics
=> kein zusätzlicher Miner
=> zusätzliche Carry-Kapazität
```

Umsetzen:

- dynamische Miner-Zahl
- dynamische Hauler-Kapazität
- Worker-/Builder-/Upgrader-Bedarf
- dynamische Creep-Bodies
- Body-Optimierung nach `energyCapacityAvailable`
- Spawn-Energie reservieren
- Pre-Spawning vor TTL-Ende
- Replacement berücksichtigt:
  - verbleibende TTL
  - Spawnzeit
  - Reisezeit
  - kritische Funktion
- Job-basierte Zuweisung
- Economy-Stall-Erkennung

Abschlusskriterium:

Creep-Anzahl und Creep-Bodies passen sich automatisch an reale Bottlenecks an.

---

## Phase 3 – Colony Health System

Ziel:

Die Colony soll numerisch bewerten können, wie gesund sie ist und warum.

Beispiel:

```text
E8N1 HEALTH 84/100

Economy        91
Logistics      67
Infrastructure 72
Controller     95
Defense       100
Recovery      100
CPU            98
```

Bewerten:

- Energieproduktion
- Energieversorgung
- Spawn-Auslastung
- Creep Replacement
- Controller-Sicherheit
- Baufortschritt
- Logistics
- CPU
- Bucket
- Defense
- Reserven
- offene kritische Jobs
- Source-Auslastung

Health Score muss für Strategy-Entscheidungen nutzbar sein.

Abschlusskriterium:

Der Bot erkennt nicht nur, dass etwas schlecht läuft, sondern identifiziert das konkrete Subsystem.

---

## Phase 4 – Threat / Emergency Defense Layer

Diese Phase kommt vor umfangreichem Remote Mining und Expansion.

Threat States:

```text
NORMAL
WATCH
ALERT
DEFENSE
EMERGENCY
```

### NORMAL

- normale Economy
- normale Expansion-/Upgrade-Prioritäten

### WATCH

Beispiele:

- fremder Scout
- wiederholte Sichtungen
- verdächtige Bewegungen

Reaktion:

- Intel aktualisieren
- Angriffswahrscheinlichkeit bewerten
- keine unnötige wirtschaftliche Störung

### ALERT

Beispiele:

- bewaffnete Hostiles
- Kampfgruppe in Nachbarräumen
- Remote bedroht

Reaktion:

- Verteidigungsbudget erhöhen
- kritische Spawnenergie reservieren
- Remotes bewerten / ggf. räumen
- Defender vorbereiten

### DEFENSE

Eigener Raum wird aktiv angegriffen.

Reaktion:

- Tower-Fokusfeuer
- eigene Creeps heilen
- unwichtige Arbeiten drosseln
- Defender spawnen
- Ramparts priorisieren
- Worker aus Gefahrenzonen ziehen
- kritische Strukturen reparieren

### EMERGENCY

Spawn, Controller oder Kerninfrastruktur akut gefährdet.

Reaktion:

- Economy auf Überleben umstellen
- Spawnenergie hart reservieren
- kritische Defender priorisieren
- Safe Mode bewerten
- Recovery-Plan vorbereiten

Threat Score berücksichtigt:

- ATTACK
- RANGED_ATTACK
- HEAL
- TOUGH
- MOVE
- Boosts
- Anzahl Gegner
- DPS
- Heal pro Tick
- Geschwindigkeit
- Entfernung zu Kernstrukturen
- Bewegungsrichtung
- bekannte Spielerhistorie

Safe Mode niemals aufgrund eines simplen Scouts verschwenden.

Abschlusskriterium:

Typische Spielerangriffe werden automatisch erkannt und angemessen beantwortet.

---

## Phase 5 – RCL2 → RCL4 vollständige Autonomie

Ziel:

Die frühe Colony wird ohne manuelle Eingriffe zu einer stabilen Wirtschaft.

Umsetzen:

- Extensions
- Source Container
- Controller Container
- Roads
- Towers
- Dedicated Miner
- Hauler
- Builder-Priorisierung
- Repair-Priorisierung
- Controller-Upgrading
- Storage-Vorbereitung

Baupriorität grundsätzlich:

```text
1. Überleben
2. Energiefluss
3. Spawn-/Extension-Kapazität
4. Verteidigung
5. kritische Infrastruktur
6. Controller-Fortschritt
7. Komfort / Optimierung
```

Construction Sites stufenweise erzeugen. Keine unnötige große Site-Flut, wenn sie keinen unmittelbaren Nutzen bringt.

Abschlusskriterium:

RCL1 → RCL4 funktioniert vollständig autonom und recoverbar.

---

## Phase 6 – Runtime Room Planner / RCL8 Blueprint

Ziel:

Der strategische Raumplan wird Teil des laufenden Bots.

Der Planner verwaltet Positionen für:

- Spawns
- Extensions
- Storage
- Terminal
- Factory
- Towers
- Labs
- Links
- Observer
- Nuker
- Power Spawn
- Roads
- Ramparts
- Source Container
- Controller-Infrastruktur

Anforderungen:

- RCL-abhängige Freischaltung
- frühe Strukturen blockieren spätere RCL8-Strukturen nicht
- Terrain und reale Blockaden berücksichtigen
- Plan persistent speichern
- Planversionierung
- Migration zwischen Planner-Versionen
- Bau-Priorität getrennt von Layout-Priorität

Abschlusskriterium:

Der Raum kann sich vom ersten Spawn bis RCL8 entwickeln, ohne grundlegenden Layout-Neubau zu benötigen.

---

## Phase 7 – RCL4 → RCL6

Ziel:

Von früher Colony zur wirtschaftlich skalierbaren Basis.

Umsetzen:

- Storage-zentrierte Logistics
- Link-Netzwerk
- besser skalierte Bodies
- Tower-Defense
- Repair-Budgets
- größere Upgrader-/Builder-Bodies
- Energy Buffering
- Terminal-Vorbereitung
- Mineral-Vorbereitung
- stärkere CPU-Caches

Abschlusskriterium:

Die Colony erreicht RCL6 stabil und ohne manuelle Eingriffe.

---

## Phase 8 – Traffic und Pathing System

Ziel:

Reisezeit, Stau und PathFinder-CPU reduzieren.

Umsetzen:

- Path Cache
- Cost Matrix Cache
- Traffic Heatmap
- Road-Nutzung messen
- Road-Bau nach realem Verkehr priorisieren
- Stau-Erkennung
- feste Miner-Positionen
- Upgrader-Positionen
- Hub-Parkpositionen
- unterschiedliche Pathing-Profile für:
  - Economy
  - Combat
  - Scouts
  - Remote Mining

Abschlusskriterium:

Weniger Reisezeit und geringere Pathing-CPU bei höherem Energiedurchsatz.

---

## Phase 9 – Intelligence / Scouting

Ziel:

Strategische Entscheidungen basieren auf aktueller Weltinformation.

Pro Raum speichern:

- Raumstatus
- Controller
- Besitzer
- Reservierung
- RCL
- Sources
- Mineral
- Strukturen
- Spawn/Tower-Positionen
- Hostiles
- Traffic
- Remote-Eignung
- Expansion-Eignung

Pro Spieler speichern:

- letzte Sichtung
- bekannte Räume
- RCL
- militärische Aktivität
- Scouts
- Angriffe
- Expansion
- bekannte Combat-Patterns

Scout-Aufträge dynamisch erzeugen.

Abschlusskriterium:

Der Bot besitzt ein dauerhaftes, aktualisiertes strategisches Weltmodell.

---

## Phase 10 – Remote Mining

Erst nach stabiler Economy, Defense und Intelligence.

Wirtschaftlich bewerten:

```text
expected remote income
- miner spawn cost
- hauler spawn cost
- reservation cost
- travel loss
- road/container cost
- expected hostile loss
= remote net value
```

Umsetzen:

- Remote Miner
- Remote Hauler
- Reservierer
- Container
- Roads
- Threat Monitoring
- Retreat
- automatische Deaktivierung unwirtschaftlicher Remotes
- dynamische Transportdimensionierung

Abschlusskriterium:

Jeder aktive Remote erhöht den Nettoertrag des Empires messbar.

---

## Phase 11 – Advanced Defense

Ziel:

Von einfacher Reaktion zu taktischer Verteidigung.

Umsetzen:

- Tower Target Scoring
- Fokusfeuer
- Heilprioritäten
- Rampart-Steuerung
- Defender Body Optimizer
- Melee / Ranged / Heal-Kombinationen
- Kiting
- Boost-Erkennung
- Schadenssimulation
- gegnerische Heal-Leistung gegen eigenen DPS rechnen
- Breach-Risiko
- Safe-Mode-Entscheidungsmodell
- Vorwarnung aus Nachbarräumen
- strategische Energie-/Boost-Reserven

Abschlusskriterium:

Die Verteidigungsstrategie passt sich automatisch der konkreten gegnerischen Komposition an.

---

## Phase 12 – Expansion Colony #2

Voraussetzung:

- GCL erlaubt Claim
- `ownedRooms < 3`
- bestehende Colony ausreichend gesund
- Expansion wirtschaftlich und strategisch sinnvoll

Zwei getrennte Bewertungen:

```text
RoomScore
= Qualität des Raums selbst

EmpireFitScore
= Wie gut ergänzt der Raum das bestehende Empire?
```

ExpansionScore beispielsweise:

```text
RoomScore
+ EmpireFitScore
+ StrategicValue
- ThreatRisk
- BootstrapCost
```

Bewerten:

- Source-Anzahl
- RCL8-Layout
- Verteidigbarkeit
- Remotes
- Mineral
- Gegner
- Entfernung zur Hauptkolonie
- Terminal-Distanz
- Expansion-Korridor
- gegenseitige militärische Unterstützung

Umsetzen:

- Claimer
- Pioneer-Team
- Spawn-Planung
- neue Colony Session
- Support aus bestehender Colony
- Übergabe in autonome Colony

Abschlusskriterium:

Colony #2 kann autonom gegründet und stabilisiert werden.

---

## Phase 13 – Empire Manager

Ziel:

Mehrere Colonies als ein Gesamtsystem steuern.

Empire Layer entscheidet über:

- Ressourcenverteilung
- Energieunterstützung
- militärische Unterstützung
- Expansion
- Produktionsschwerpunkte
- Boost-Produktion
- Terminal-Transfers
- strategische Reserven

Colonies können unterschiedliche Schwerpunkte erhalten:

```text
Colony A – Core / Economy / Hub
Colony B – Industry / Labs / Factory
Colony C – Frontier / Remotes / Defense
```

Diese Rollen sind dynamisch und keine permanente harte Zuordnung.

---

## Phase 14 – Expansion Colony #3

Gleiche Sicherheits- und Bewertungslogik wie Colony #2.

Zusätzlich muss der dritte Raum den höchsten möglichen zusätzlichen Empire-Nutzen liefern.

Nach erfolgreichem Claim:

```text
ownedRooms == 3
=> sämtliche weiteren Claim-Aktionen hart deaktivieren
```

Abschlusskriterium:

Drei vollständig koordinierte Colonies arbeiten autonom zusammen.

---

## Phase 15 – RCL6 → RCL8 und Industrie

Umsetzen:

- Terminal
- Mineral Mining
- Extractor
- Labs
- Reactions
- Boost-Produktion
- Factory
- Commodities
- Power Spawn
- Power Processing
- Observer
- Nuker
- vollständiges Link-Netzwerk
- RCL8-Endlayout
- defensive Rampart-Infrastruktur

Industrieproduktion erfolgt nur aufgrund von Bedarf oder messbarem strategischem Nutzen.

---

## Phase 16 – Advanced Combat / Offensive Strategy

Ziel:

Neben Defense auch aktive strategische Combat-Fähigkeiten.

Umsetzen:

- Gegnerprofiling
- Offensive Target Scoring
- Combat Simulation
- Squad Composition
- Boost-Auswahl
- Heal/DPS-Berechnung
- Breach Planning
- Rampart Breaking
- Dismantling
- Ranged Kiting
- Siege Logistics
- Remote Denial
- Counterattack
- Room Assault
- taktischer Rückzug

Offensive Entscheidung nicht nach simplen Regeln.

Bewerten:

```text
ExpectedBenefit
versus
SpawnCost
+ BoostCost
+ LostEconomy
+ TravelTime
+ DefensiveRisk
+ OpportunityCost
```

Der Bot soll keinen aussichtslosen Krieg weiterführen, wenn Rückzug wirtschaftlich sinnvoller ist.

---

## Phase 17 – Markt und Ressourcenwirtschaft

Umsetzen:

- aktuelle Preise
- historische Preise
- Transaction Cost
- effektiver Kauf-/Verkaufspreis
- Ressourcenreserven
- automatische Überschussverkäufe
- Beschaffung kritischer Ressourcen
- interne Transfers vor externen Käufen
- strategische Boost-Reserven
- Order Management

Keine Marktentscheidung anhand eines einzelnen Preispunkts.

---

## Phase 18 – Adaptive Strategy Layer

Langfristig kann das Empire zwischen Strategiemodi wechseln:

```text
RECOVERY
ECONOMY
GROWTH
DEFENSE
WAR_PREPARATION
OFFENSE
EXPANSION
INDUSTRY
RESOURCE_ACCUMULATION
```

Strategy entscheidet anhand von:

- Colony Health
- Empire Health
- Bedrohung
- Nachbarn
- Ressourcen
- GCL
- CPU
- Entwicklungsstand
- Markt
- Expansion Opportunities

Strategiemodi sind Prioritätsprofile, keine komplett getrennten Bots.

---

## Phase 19 – Reset Hardening

Der Reset am 2027-02-01 wird als vollständiger Autonomie-Test genutzt.

Vor dem Reset erfassen:

- Zeit bis initialer Spawn
- Zeit bis erster Creep
- Zeit bis stabile Economy
- RCL2
- RCL3
- RCL4
- RCL5
- RCL6
- RCL7
- RCL8
- erste Remote Source
- zweite Colony
- dritte Colony
- CPU pro Colony
- Spawn-Auslastung
- Energieertrag
- Recovery-Zeit nach Verlusten

Nach dem Reset dieselben Kennzahlen erneut messen.

Langfristiges Ideal:

```text
Welt analysieren
→ besten Start-Raum wählen
→ Spawn sicher platzieren
→ Bot starten
→ vollständige weitere Entwicklung autonom
```

---

# 5. Recovery-Anforderungen

Jedes wichtige Subsystem muss Recovery berücksichtigen.

Der Bot muss selbstständig wieder stabil werden nach:

- 0 Creeps
- Verlust eines Harvesters
- Verlust aller Hauler
- leerer Spawnenergie
- Angriff
- Remote-Verlust
- Spawn-/Strukturverlust
- Code-Neustart
- Memory-Reset
- Planner-Versionwechsel
- zeitweisem CPU-Mangel

Recovery hat Vorrang vor Wachstum.

---

# 6. Telemetrie- und Alert-Spezifikation

Regelmäßig erfassen:

- Tick
- Colony Session
- Runtime-Version
- RCL
- Controller Progress
- ticksToDowngrade
- Energy available / capacity
- gespeicherte Energie
- Energieproduktion
- Source-Durchsatz
- Transport-Durchsatz
- Creeps nach Funktion
- TTL
- Spawn-Auslastung
- Spawn Queue
- Jobs
- Construction Sites
- Build-Fortschritt
- CPU
- Bucket
- Hostiles
- Threat State
- Health Score
- Errors
- Warnings

Normaler Status:

```text
STATUS_SNAPSHOT ungefähr alle 100 Ticks
```

Sofortige Alerts beispielsweise:

```text
CRITICAL_EXCEPTION
NO_HARVESTER
ECONOMY_STALLSPAWN_STALLED
CPU_BUCKET_LOW
HOSTILES_DETECTED
DEFENSE_REQUIRED
CONTROLLER_DOWNGRADE_RISK
ROOM_LOSS_RISK
REMOTE_LOST
CLAIM_LIMIT_GUARD
```

---

# 7. Logging-Regeln

- Historische Evidence niemals umschreiben.
- Verifikationsdaten append-only behandeln.
- Respawns und Neustarts über `colonySessionId` unterscheiden.
- Runtime-Version immer loggen.
- Keine Passwörter oder API-Tokens loggen.
- Keine Zugangsdaten an Telemetrie-Endpunkte übertragen.
- Fehler, Warnungen und Statusdaten getrennt klassifizieren.
- Telemetrie muss maschinenlesbar bleiben.

---

# 8. Entwicklungsprinzipien

```text
Stabilität vor Features.
Economy vor Expansion.
Defense vor umfangreicher Expansion.
Messung vor Optimierung.
Recovery vor Wachstum.
Nettonutzen statt bloßer Aktivität.
```

Für jede wesentliche Änderung:

```text
Hypothese
→ Implementierung
→ lokale Tests
→ Live-Deployment
→ Messzeitraum
→ Vergleich vorher/nachher
→ nächste Entscheidung
```

Weitere Regeln:

- keine unnötigen Magic Numbers, wenn Werte aus Telemetrie berechnet werden können
- selten veränderte Berechnungen cachen
- CPU-Kosten explizit messen
- keine großen Systeme gleichzeitig ändern, wenn dadurch die Ursache eines Effekts unklar wird
- Planner und Strategy getrennt halten
- Layout-Entscheidung und Bau-Priorität getrennt halten
- Safety-Invarianten dürfen vom Strategy Layer nicht überschrieben werden
- kritische Spawnenergie reservieren können
- keine Expansion bei kranker Hauptkolonie
- kein vierter Claim

---

# 9. Aktuelle Prioritätsreihenfolge

Stand nach v0.2.19, während v0.2.20 live verifiziert wird:

```text
0. v0.2.20 Critical Consumer Early Dispatch live verifizieren
1. Dynamic Economy Manager / Logistics-Latenz bis zu einem stabilen lokalen Energiefluss abschließen
2. Capacity-/Job-basierte Economy statt statischer Rollenquoten weiter ausbauen
3. Recovery- und Replacement-Autonomie härten
4. Threat / Emergency Defense Layer
5. RCL2→RCL4 vollständige Autonomie
6. Runtime Blueprint / RCL8-Layout
7. RCL4→RCL6
8. Traffic / Pathing
9. Intelligence / Scouting
10. Remote Mining
11. Advanced Defense
12. Expansion Colony #2
13. Empire Manager
14. Expansion Colony #3
15. RCL6→RCL8 + Industrie
16. Advanced Combat / Offensive Strategy
17. Markt / Ressourcenwirtschaft
18. Adaptive Strategy
19. Reset Hardening als kontinuierliche Querschnittsaufgabe und finaler End-to-End-Benchmark
```

Die Phasen sind strategische Entwicklungsbereiche, keine starre Release-Reihenfolge. Kleine datengetriebene Zwischen-Releases dürfen jederzeit eingeschoben werden, wenn Live-Evidence einen konkreten Bottleneck zeigt.

---

# 10. Aktuell bekannte technische Beobachtungen

Aus dem zuletzt verifizierten v0.2.19-Live-Fenster und dem laufenden v0.2.20-Experiment:

- Newbieland-BOTLOGs werden strukturiert verarbeitet.
- Colony Session Tracking funktioniert.
- Durable Telemetry mit monotonem `jseq` und Offline-Catch-up funktioniert.
- `STATUS_SNAPSHOT` und `ROOM_HEARTBEAT` liefern die benötigten Economy-/Health-/Efficiency-Daten.
- Gate-kritische Productive-Flow-Felder werden in serialisierungssicherer Tiefe gespiegelt.
- Der Live-Verifier überspringt unbrauchbare vollständige Fenster und wartet automatisch auf das nächste verwertbare Fenster.
- Consumer-Fallback kann trotz ausreichender aggregierter Hauler-Kapazität auftreten.
- v0.2.19 zeigte `waitingRatio=0.212`, `fallbackRatio=0.097` und `maxWaitingEnergyTicks=12`.
- Construction-WORK-Kapazität war deutlich höher als realisierter Construction-Durchsatz; Controller-Auslastung lag dagegen nahe an der verfügbaren Controller-Kapazität.
- Daraus folgt als aktuelle Arbeitshypothese: Last-Mile-Delivery-Latenz ist der primäre lokale Bottleneck.
- v0.2.20 testet einen begrenzten Early-Dispatch-Mechanismus für genau einen teilweise beladenen Hauler bei kritischem Consumer-Warten.
- Single-Hauler-Recovery, Hard-Infrastructure-Priorität, Mining-Kapazität und Hauler-Sizing bleiben dabei unverändert.
- Die Roadmap selbst ist langfristig; aktuelle Live-Zahlen und PR-Status müssen bei jeder Übergabe gegen GitHub/Telemetry frisch geprüft werden.

---

# 10.1 Pflegeprotokoll für diese Roadmap

Diese Datei ist die kanonische strategische Roadmap im GitHub-Repository.

Jeder Chat, der am Bot weiterarbeitet, soll:

1. die Roadmap vor größeren Architekturentscheidungen lesen;
2. den Live-Stand nicht blind aus historischen Abschnitten übernehmen, sondern gegen aktuelle GitHub-/Telemetry-Daten prüfen;
3. nach einem verifizierten Release den Abschnitt **Aktueller Live-Stand** aktualisieren;
4. abgeschlossene Releases/Phasen nachvollziehbar ergänzen, ohne historische Evidence umzuschreiben;
5. laufende Releases mit Branch/PR und Verifikationsstatus dokumentieren;
6. neue langfristige Architekturentscheidungen in der passenden Phase ergänzen;
7. keine neue Phase oder Slice-Nummer erfinden, wenn die Roadmap bereits eine passende Phase enthält;
8. Safety-Invarianten wie das Drei-Raum-Limit, Recovery > Growth und Defense > Expansion nicht stillschweigend abschwächen.

Die Roadmap ist ein lebendes Planungsdokument; Verification Evidence bleibt dagegen append-only.

---

# 11. Übergabe an einen neuen Chat

Diese Datei kann einem neuen Chat vollständig zur Verfügung gestellt werden.

Zusätzlich sollte der Übergabe-Prompt enthalten:

```text
Arbeite an meinem Screeps-Bot auf Newbieland weiter.

Lies zuerst `SCREEPS_BOT_MASTER_ROADMAP.md` im Repository vollständig.

Wichtige Regeln:
- Die Roadmap definiert die langfristige Zielarchitektur und Prioritäten.
- Maximal 3 geclaimte Räume.
- Server-Reset am 2027-02-01.
- Öffentlich sichtbare Screeps-Namen neutral halten.
- Änderungen datengetrieben durchführen.
- Historische Evidence nicht umschreiben.
- Nach größeren Änderungen live messen.
- Safety- und Recovery-Mechanismen nicht zugunsten neuer Features entfernen.
- Aktuellen Live-Stand immer aus den neuesten Logs ermitteln und nicht blind aus der Roadmap übernehmen.

Aktuelle Runtime und Logs können neuer sein als der Statusblock in der Roadmap.
Prüfe daher zuerst die aktuellsten bereitgestellten Telemetrie-/Logdateien.
```

---

# 12. Endziel

Der fertige Bot soll:

- einen optimalen Start-Raum auswählen
- einen sicheren initialen Spawn planen und platzieren
- aus einem einzelnen Spawn autonom starten
- RCL1 bis RCL8 selbstständig durchlaufen
- eine dynamische Economy betreiben
- Bottlenecks erkennen
- Creep-Bodies automatisch optimieren
- nach Verlusten selbstständig recovern
- Angriffe anderer Spieler erkennen und abwehren
- strategische offensive Operationen durchführen können
- Remotes wirtschaftlich betreiben
- Nachbarräume kontinuierlich überwachen
- neue Räume anhand von RoomScore und EmpireFitScore auswählen
- maximal drei Colonies aufbauen
- diese drei Colonies als gemeinsames Empire koordinieren
- Industrie, Boosts und Markt autonom verwalten
- CPU-effizient arbeiten
- seine Strategie anhand realer Welt- und Telemetriedaten anpassen
- nach dem Server-Reset mit möglichst wenig manueller Hilfe neu starten können

Der Bot soll langfristig ohne manuelle Mikrokontrolle spielbar sein.