# Lizenzen von Drittsoftware

BreadCraft selbst steht unter der MIT-Lizenz (siehe [LICENSE](LICENSE)).
Es bündelt bzw. nutzt folgende Fremdsoftware, deren Lizenzbedingungen erhalten bleiben:

## Mitgeliefert (im Auslieferungspaket enthalten)

- **cc65** — die 6502-C-Toolchain (`cl65` und zugehörige Werkzeuge), unter
  `resources/cc65/`. Lizenz: **zlib** (siehe `resources/cc65/LICENSE`). Die zlib-Lizenz
  erlaubt freie Nutzung und Weitergabe; der Lizenzhinweis bleibt erhalten.

## Genutzt, aber NICHT mitgeliefert

- **VICE** (C64-Emulator) — wird vom Nutzer separat installiert; BreadCraft ruft nur
  den vorhandenen Pfad auf. VICE steht unter **GPL-3.0**; da es nicht gebündelt,
  sondern nur als externes Programm aufgerufen wird, berührt seine Lizenz die
  MIT-Lizenz von BreadCraft nicht.

## Bibliotheken (npm)

Die Laufzeit- und Build-Abhängigkeiten (Electron, Vue, Pinia, Vue Router, Monaco
Editor, vue-i18n u. a.) stehen unter ihren jeweiligen, überwiegend permissiven
Lizenzen (MIT/Apache-2.0/BSD). Details im jeweiligen Paket unter `node_modules/`.
