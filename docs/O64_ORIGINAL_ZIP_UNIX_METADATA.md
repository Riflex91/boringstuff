# O64 – Dateityp- und Rechtemetadaten historischer GitHub-ZIPs

Datum: 18. Oktober 2026. Nur offline und schreibgeschützt.

## Lücke

O58/O60 verifizieren die ursprünglichen ZIP-Bytes, Daten-Deskriptoren,
CRC, Pfade, Größen und jeweils 82 gesicherte Spielmodule. Der generische
ZIP-Prüfer hat jedoch das zentrale `version made by`-Betriebssystem,
den Unix-Dateityp und die externen Dateiattribute nicht bewertet.
Ein Archiv konnte trotz unauffälliger Datei-Endung und unbeschädigtem
Inhalt einen Symlink, ein Verzeichnis, ein Gerät oder eine ausführbare
Datei in den ZIP-Metadaten deklarieren. Die **exakt gepinnten**
ursprünglichen SHA256-Hashes verhindern bereits eine solche Manipulation
bei den beiden O58-Originalen; O64 schließt die Lücke zusätzlich bei
der generischen ZIP-Strukturprüfung.

## Umsetzung

Der O58-Prüfer prüft jetzt die zentralen Origin- und Dateiattribute:
- Unix-Dateien (Creator-OS 3) werden nur als reguläre, nicht ausführbare
  Dateien mit Mode `0644` beziehungsweise `0600` und regulärem
  Archiv-Bit akzeptiert. Symlinks, Verzeichnisse, Device-Nodes,
  setuid/setgid, ausführbare Dateien und Gruppen-Schreibrechte HOLD.
- DOS-Quellen (Creator-OS 0) dürfen nur neutrale Attribute oder das
  übliche Archiv-Bit tragen; Verzeichnis-, System- oder Hidden-Bits
  werden abgewiesen. Andere Ursprungssysteme benötigen Code-Review.
- Zusätzlich verlangt `verifyPinnedOriginalArtifactZip` **genau**
  die Metadaten der beiden wirklich abgerufenen GitHub-Actions-ZIPs:
  Unix-Quelle, `0x81a40020` als externes Attribut und keine internen
  Zusatzflags.
- Der neue Offline-Test `o64-original-zip-filetype-and-mode.test.mjs`
  baut bewusst synthetische ZIPs und injiziert Symlink-, Directory-,
  Device-, Executable-, fremde-OS- und Dateiattribut-Manipulationen.

Die zuvor heruntergeladenen Original-ZIPs wurden am 18. Oktober lokal
erneut geprüft. Alle drei World-Mitglieder sowie beide Newbieland-
Mitglieder weisen `create_system=3`,
`external_attr=0x81a40020` und jeweils die erwarteten Original-SHA256-
Werte auf. Es wird dabei **kein** neuer, produktiver Screeps-Zugriff
behauptet. Die echten ZIP-Inhalte werden nicht in Git oder Actions
aufgenommen.

## Nächste offene Schritte

Ein JavaScript-Ende-zu-Ende-Lauf mit dem exakt ausgecheckten O62-Skript
und den echten ZIP-Dateien ist weiterhin **nicht** als bestanden
bestätigt; die O63-Kryptografieprobe war unabhängig implementiert.
Ebenso fehlen echte Betreiber-Schlüsselverwahrung und überprüfte,
unabhängig kontrollierte Langzeitarchivierung. Der World-166-Tick-
Nachweis stammt von einem älteren Commit als Main, daher bleiben
Freigaben, Main-Merges, Writer-Ref-Änderungen und produktive Uploads
gesperrt.

**Release: `HOLD_EXACT_PREDECESSOR_PAIR_MISSING`.**
