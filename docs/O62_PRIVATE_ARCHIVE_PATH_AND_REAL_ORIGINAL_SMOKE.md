# O62 – kanonisches privates Archivziel und echte Offline-Ende-zu-Ende-Probe

Status: **OFFLINE / REVIEW ONLY**, gestapelt auf O61 Draft-PR #408.

## Sicherheitslücke im O57-Archivierungswerkzeug

O57 hatte den Ausgabepfad mit `path.relative(repoRoot, outputParent)`
verglichen. Ein Pfad außerhalb des Repositories kann aber über einen
Symlink in einem **übergeordneten** Verzeichnis in das Repository
zurückführen. `lstat(outputParent)` erkennt diesen Fall nicht, wenn
das letzte Pfadelement selbst ein echtes Verzeichnis ist.

O62 überprüft deshalb den mit `realpath` aufgelösten Zielpfad gegen
das kanonische Git-Checkout. Unter POSIX muss das Ausgabeverzeichnis
dem ausführenden Benutzer gehören und darf **keine Rechte für Gruppe
oder andere Benutzer** haben. Eine vom Benutzer kontrollierte private
Ablage ist Voraussetzung. Windows-Datei-ACLs werden nicht durch die
POSIX-Modusprüfung zertifiziert und müssen unabhängig administriert
werden.

Bisherige Original-ZIP-Eingaben wurden nach `lstat(path)` erneut über
den Pfad gelesen. O62 öffnet die Datei mit `O_NOFOLLOW` (sofern von
der Plattform unterstützt), prüft den **geöffneten Deskriptor** mit
`fstat` und liest denselben Deskriptor. Direkte Symlinks sowie Quellen,
deren kanonischer Pfad ins Git-Checkout zeigt, werden abgewiesen.
SHA-256 und O58/O60-ZIP-Prüfung bleiben weiterhin erforderlich. Ein
maliziöser Prozess desselben Benutzers mit Schreibrechten am
Ausgabepfad ist damit noch nicht vollständig als Race-Angreifer
ausgeschlossen; die private Verzeichnisverwaltung bleibt erforderlich.

## Freiwillige Offline-Probe mit den beiden echten Original-ZIPs

Nach O58 liegen die authentischen heruntergeladenen Original-ZIP-Dateien
in der Konversations-Arbeitsablage, aber **nicht** in einem zugesicherten
unabhängig kontrollierten Langzeitspeicher.

`tools/o62-local-original-pair-smoke.mjs` verbindet nun den echten
O57-Archivierungsaufruf mit der O61-Privatschlüssel-Wiederherstellung.
Der Befehl nutzt einen nur für den Test generierten RSA-3072-Schlüssel
in einem privaten temporären Verzeichnis. Er erzeugt aus den zwei
**exakt SHA256-gepinnten Originaldateien** ein temporär verschlüsseltes
Archivpaar, authentisiert die Entschlüsselung im Arbeitsspeicher und
prüft die echten ZIP-/Deployment-Receipts erneut. Anschließend
entfernt er das **gesamte temporäre Testverzeichnis** einschließlich
Schlüssel und Archive. Weder Original-ZIPs noch der produktive Bot
werden verändert. Der temporäre Schlüssel ist ausdrücklich **kein**
dauerhaft verwahrter Recovery-Key.

Beispiel in PowerShell mit expliziten vorhandenen ZIP-Dateien:

```powershell
node .\tools\o62-local-original-pair-smoke.mjs --world-zip "C:\PrivateDownloads\world-original-12007967018.zip" --newbieland-zip "C:\PrivateDownloads\newbieland-original-12024822115.zip"
```

Erfolg bedeutet `O62_REAL_ORIGINAL_PAIR_OFFLINE_SMOKE_PASS`. Ein
lokaler Erfolg bestätigt, dass **die tatsächlichen Originalbytes**
durch die O57- und O61-Verschlüsselungs-/Entschlüsselungskette laufen.
Es bestätigt **nicht**, dass der Benutzer die Archive bereits
dauerhaft unabhängig gesichert hat. Im GitHub-CI-Lauf sind nur
synthetische Testdaten enthalten; gefälschte Original-ZIPs führen
verbindlich zu HOLD.

## Unveränderte Release-Grenzen

- Kein echter aktueller World-`LIVE_100T_PASS` auf exaktem Main
  `bc43f2faf1f345e63d9bfe78b6bbaa59e5eaab0c`.
- Keine geprüfte dauerhafte externe Archivkopie oder
  Betreiber-Privatschlüsselverwahrung.
- Kein freigegebener zweiphasiger produktiver Schreib-Executor,
  kein atomar sicherer globaler Writer-Lock-Release.
- Keine produktiven Screeps-POSTs, Spawn-/Respawn-Aktionen,
  GitHub-Writer-Ref-Änderungen oder Main-Merges.

**HOLD_EXACT_PREDECESSOR_PAIR_MISSING.**
