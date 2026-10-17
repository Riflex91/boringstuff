# O61 – Offline-Abnahme des verschlüsselten historischen Archivpaars

Status: **OFFLINE, REVIEW ONLY**. Gestapelt auf O60; Main bleibt auf
`bc43f2faf1f345e63d9bfe78b6bbaa59e5eaab0c`. Keine Schreibroutine
für Screeps, keine GitHub-Ref-Änderung und keine Merge-Freigabe.

## Ergänzung zu O57/O58

O57 konnte zwei originale GitHub-Actions-ZIPs mit einem
extern bereitgestellten **öffentlichen** RSA-3072-Schlüssel verschlüsseln.
O58 und O60 prüfen diese unveränderten Originaldateien bereits
gegen feste ZIP-SHA256, Deployment-Receipts und ZIP-Daten-Deskriptoren.
Es fehlte bisher ein direkt nutzbarer, separater Recovery-Test des
**vollständigen verschlüsselten Archivpaars**.

`tools/o61-verify-private-evidence-pair.mjs` erledigt nun Folgendes:

1. Externes Archivverzeichnis mit **genau** den Ordnern `world` und
   `newbieland`; keine zusätzlichen Dateien und keine Symlink-Einträge.
2. Je Server die originale O57-Manifeststruktur, exakt zugeordneten
   Commit, Artefakt-IDs, Dateigrößen und Ciphertext-Hash prüfen.
3. Identischer RSA-Public-Key-Fingerprint beider Empfänger; **verschiedene**
   AES-GCM-IVs, Schlüsselhüllen und Ciphertext-Hashes.
4. Eine explizit angegebene RSA-3072+-**Privatschlüsseldatei** außerhalb
   des Repositories laden (unter POSIX nur ohne Group-/Other-Leserechte).
   Key-Fingerprint unabhängig aus dem privaten Schlüssel ableiten.
5. Beide Archives **nur im Speicher** authentisiert entschlüsseln.
   Plausibel entschlüsselte ZIPs reichen nicht: ihre Bytes müssen exakt
   den O58-SHA256-Werten entsprechen; zusätzlich O58-/O60-ZIP- und
   Deployment-Receipt-Prüfung mit je 82 Modulen.
6. Bei Fehler ausschließlich `O61_PRIVATE_EVIDENCE_PAIR_HOLD`.
   Keine Ausgabe von Schlüssel, originalem Code oder Geheimnissen,
   keine Plaintext-ZIP auf Festplatte, keine Schreib-/Deploy-Befugnis.

## Ausführung auf dem Rechner des Archiv-Eigentümers

Voraussetzung: Der Benutzer hat die beiden *Original*-ZIP-Dateien aus
O58 heruntergeladen, das O57-Archiv **außerhalb des Git-Repos** in einen
privaten Speicher geschrieben und verwahrt den dazu passenden
RSA-Privatschlüssel sicher außerhalb gemeinsam genutzter Runner.

Windows-PowerShell-Beispiel:

```powershell
node .\tools\o61-verify-private-evidence-pair.mjs --archive "C:\PrivateScreepsEvidence\o57-original-evidence-v1" --private-key "C:\PrivateKeys\archive-recipient.private.pem"
```

Ein erfolgreicher Lauf meldet
`O61_PRIVATE_EVIDENCE_RECOVERY_VERIFIED` mit
`originalBytesVerified:true`. Das bedeutet **nur**, dass die zwei
lokal übergebenen Archive zu den historisch gepinnten O58-Originalen
passen und mit dem übergebenen Schlüssel wiederherstellbar sind.
Es bestätigt keine dritte, unabhängig kontrollierte Replik, keine
verifizierte Verwahrung bei einem externen Anbieter und keine Freigabe
zur Produktion.

In CI werden ausschließlich kurzlebige synthetische RSA-Schlüssel und
Pseudo-ZIPs verwendet. Die positiven AES-/RSA-Roundtrips testen die
Kryptografie; die vollständige O61-Prüfung muss solche Pseudo-ZIPs
zurückweisen. Eine erfolgreiche Prüfung mit den *echten* Archiv-Bytes
kann nicht sinnvoll vorgetäuscht werden und ist daher an den
tatsächlichen privaten Speicher gebunden.

## Verbleibende Roadmap-HOLDs

- Archivkopie in einem unabhängig kontrollierten privaten, langlebigen
  Speicher samt unabhängiger Wiederherstellung weiterhin nicht belegt.
- Historischer World-PASS stammt aus `3f145905...`; für exakt
  `bc43f2fa...` fehlt `LIVE_100T_PASS`.
- Kein autorisierter World-POST-Executor mit tatsächlichem Backup/Restore
  und sauberer atomarer Writer-Lock-Freigabe.
- Keine Freigabe für Main-Merge, World-Code-Upload, Spawn/Respawn/Reset,
  Branch-Aktivierung oder GitHub Writer-Ref DELETE.

**Release: `HOLD_EXACT_PREDECESSOR_PAIR_MISSING`.**
