# O63 – Privatsphäre des Beweisarchivs und Schlüsselhygiene

Datum: 17. Oktober 2026. Gestapelter Offline-Branch auf O62 PR #409.
Main bleibt exakt `bc43f2faf1f345e63d9bfe78b6bbaa59e5eaab0c`.

## Bestätigte Lücke

Bisher prüfte O57 die Kryptografie des Archivs und O61 die Integrität
des Archivpaars. Ein Archiv mit zu weit geöffneten Dateirechten
(`archive.enc`, `archive-manifest.json` oder Unterverzeichnisse mit
POSIX-Bits für Gruppe/Andere) konnte aber trotz gültiger Verschlüsselung
als geprüft gelten. Auch direkte Bibliotheksaufrufe der O57-Sealing-
Funktion waren nicht vollständig an die O62-CLI-Pfadprüfung gebunden.
Eine lokale Exposition chiffrierter Inhalte und Meta-/Empfängerdaten ist
keine gewünschte private Archivverwahrung.

## Änderungen

- `tools/o63-private-vault-file-policy.mjs` kontrolliert, dass
  Archivverzeichnisse und Dateien wirklich außerhalb des kanonisch
  aufgelösten Git-Checkouts liegen, keine Symlinks sind und unter POSIX
  dem ausführenden Nutzer gehören und weder Gruppen- noch öffentliche
  Rechte haben. Unter Windows können ACLs damit NICHT überprüft werden;
  eine separate Betreiberprüfung ist erforderlich.
- O57 verlangt auch bei direkten Sealing-Bibliotheksaufrufen einen
  privaten und externen Ziel-Elternordner; der Read-only-Inspector
  verweigert die Prüfung von zu weit zugänglichen Archiven.
- O61 verweigert ganze Archivpaare, wenn Oberordner, Serverordner,
  Manifest- oder Chiffredatei die privaten Rechte verletzen.
- RSA-entpackte AES-Inhaltsschlüssel werden nach der Benutzung
  bestmöglich im JavaScript-Buffer überschrieben; bei fehlgeschlagener
  Wiederherstellung ebenso bereits freigegebene Klartextpuffer.
  Bei O61 wird Klartext auch dann gelöscht, wenn erst die finale
  SHA-/ZIP-/Receipt-Prüfung fehlschlägt. Garbage-Collector-Kopien und
  kryptografische Laufzeitkopien können damit NICHT garantiert gelöscht
  werden; es handelt sich um Best-Effort-Speicherhygiene.
- Synthetische Negativtests prüfen `0755`/`0770`-Ordner,
  `0644`-Chiffre/Manifest, symlinkersetzte Dateien und die direkte
  Archivierung ins Repository. Tests und P3 laufen offline ohne
  Produktionszugangsdaten.

## Echte historische Originale separat geprüft

In der lokalen Arbeitsumgebung wurden die zwei in O58 authentifizierten
Original-ZIP-Dateien noch einmal geprüft und **unabhängig von der
O62-JavaScript-Implementierung** durch einen rein lokalen
RSA-3072-OAEP/SHA256- und AES-256-GCM-Verschlüsselungs-/Wiederherstellungs-
Test geführt. Die entschlüsselten Dateien waren byte-identisch mit
folgenden historischen ZIP-SHA256-Werten:

- World: `257ad662770e5b425c1f7322b5d240d8e3ca84aa76517f78d967ee29a21bb944`
- Newbieland: `6a7b2db73798fd47a894c8741f830a97436cf9b19c7249ba74e0f81aa35cb685`

CRC-Prüfungen, je 82 Backup-Module und Deployment-ID-Konsistenz bestanden.
Die Testschlüssel und zeitweiligen Chiffre-Dateien wurden aus dem
temporären Testverzeichnis entfernt. Das ist eine unabhängige
**Kryptografie-Integration**, nicht die Ausführung des O62-Skripts
mit echten Originalen und kein Beleg für unabhängige Dauerverwahrung.
Die privaten Original-ZIP-Bytes sind nicht im Repository oder der
GitHub-Actions-CI enthalten.

## Externe Restvoraussetzungen

Echte Betreiber-RSA-Schlüssel mit sicherer Langzeitverwahrung, private
externe Sicherung einschließlich unabhängiger Wiederherstellung,
freigegebener zweiphasiger World-Executor, sicheres globales
Writer-Lifecycle-Protokoll, aktueller World-Exact-Main-
`LIVE_100T_PASS` und sequentielle Main-Merges sind weiterhin offen.
Altes World-166-Tick-Artefakt stammt aus einem anderen Commit als
Main. Kein synthetischer oder historischer Beweis darf es ersetzen.

**Release: `HOLD_EXACT_PREDECESSOR_PAIR_MISSING`.**
Keine produktiven POSTs, Spawns, Respawns, Branch-Aktivierungen,
Writer-Ref-Änderungen oder Main-Merges.
