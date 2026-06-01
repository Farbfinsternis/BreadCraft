# Changelog

Alle nennenswerten Änderungen an BreadCraft werden in dieser Datei festgehalten.

Das Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
die Versionierung an [Semantic Versioning](https://semver.org/lang/de/).

## [Unreleased]

### Geändert
- **Editoren brauchen jetzt ein offenes Projekt.** Ohne Projekt sind die Grafik-Editoren
  (Palette/PETSCII/…) nicht mehr erreichbar — das verhinderte „ins Leere malen", wo ein
  Speichern kein Ziel hatte. Routing-Guard leitet Editor-Routen ohne Projekt zur
  Startseite um; das Editor-Menü in der Toolbar ist ohne Projekt ausgegraut (ASSET_DOCUMENTS.md §1).
- **Speichern ist jetzt explizit (kein Auto-Save mehr).** Char-Set und Palette werden
  NUR per Speichern-Button oder **Strg+S** auf Disk geschrieben; ungespeicherte
  Änderungen gehen bei Neustart verloren (klassisches Dokument-Verhalten, vom Dirty-Punkt
  gewarnt). Das zuvor eingebaute debounced Auto-Save wurde entfernt; der Disk-IO-Unterbau
  (Serialisierung, IPC, Manifest, Byte-Konverter) bleibt unverändert (ASSET_DOCUMENTS.md §2.5).

### Hinzugefügt
- **Transpiler Stufe 2, Teil A: Frame-Sync & Grafik-Modus-Umschaltung.** Der erste
  Schritt Richtung „sieht nach Spiel aus" — der echte Multicolor-Modus lässt sich jetzt
  schalten (BREADCRAFT_TRANSPILER_ROADMAP.md Stufe 2, Sprachdef §E/§F):
  - **`VWait` → `waitvsync()`** (Frame-Sync, PAL 50Hz). **Wichtig:** das zuvor
    automatisch eingefügte `waitvsync()` in der `While 1`-Schleife wurde **entfernt** —
    `VWait` ist jetzt ein vom Nutzer geschriebener Befehl (BlitzBasic-Stil, kein
    verstecktes Auto-Insert). Stattdessen **warnt** der Transpiler, wenn eine
    Frame-Schleife (`While 1`) kein `VWait` enthält (sonst rast die Bewegung davon —
    der #1-C64-Anfängerfehler).
  - **`Graphics <Fläche>, <Farbmodus>` schaltet den VIC-Modus** über die echten
    Register: MCM-Bit (`$D016` Bit 4) für Multicolor, BMM-Bit (`$D011` Bit 5) für
    Bitmap (Referenz `_preflight/tilemap.c`). Die drei Phase-1-Modi `TEXT, HIRES` /
    `TEXT, MULTICOLOR` / `BITMAP, MULTICOLOR` werden erzeugt; `BITMAP, HIRES` ist ein
    ehrlicher Fehler (kein Phase-1-Modus). Der Farbmodus ist optional — `Graphics TEXT`
    allein bedeutet `TEXT, HIRES` (der normale Text-/UI-Fall). Der Zeichensatz-Pointer
    (`$D018`) gehört zu `UseTileset` und kommt mit Teil B.
  - **Auf echter cc65 verifiziert:** ein `Graphics TEXT, MULTICOLOR` + `Cls BLUE` +
    `DrawText` + `While 1 … VWait … Wend` baut mit dem gebündelten `cl65` zu einem
    gültigen 569-Byte-`.prg`.
  - **Noch offen (Teil B):** die Tile-Welt (`UseTileset`/`DrawMap`/`SetTile`/`SetMetaTile`,
    `UseSprite`/`UseImage`/`DrawImage`) — sie braucht die `.bread`-Asset-Auflösung
    (Charset-/Map-Daten einbacken) und meldet bis dahin ehrlich „noch kein C-Mapping".
  (+6 Vitest; 124 Tests gesamt.)
- **Transpiler Stufe 1 (erster Teil): echtes Typsystem statt „alles unsigned int".**
  Variablen tragen ihren Typ jetzt in der Schreibweise, der CodeGen leitet ihn ab
  (BREADCRAFT_TRANSPILER_ROADMAP.md Stufe 1, Sprachdef §C):
  - **`.b` → `unsigned char`, `.w` → `unsigned int`** aus dem geschriebenen Suffix;
    suffixlose Variablen werden zu **Byte** (der billige Normalfall, §C). Eine
    **Symbol-Tabelle** sammelt pro Name den Typ (das erste gesehene Suffix gewinnt —
    eine spätere suffixlose Nutzung stuft nicht zurück).
  - **`Global name.typ = wert`** → Deklaration auf **Datei-Ebene** (vor `main`) mit
    Pflicht-Initialisierung, die im `main`-Rumpf läuft. **`Const NAME = wert`** →
    `#define` (Compile-Zeit, zur Laufzeit gratis). Beide werden jetzt vom Parser als
    Anweisungen erkannt (vorher „noch nicht unterstützt").
  - **Verkleinerungs-Warnung (§C.1):** wird ein `.w`-Wert in eine `.b`-Variable
    geschrieben (Datenverlust), meldet der Transpiler eine **Warnung** — kein Fehler:
    der Build läuft weiter, die Zahl wrappt zur Laufzeit still (echte C64-Realität).
    Erweiterung (`.b` → `.w`) bleibt still. Auch ein wort-ansteckender Ausdruck
    (`.b + .w` → `.w`) löst die Warnung beim Schreiben in ein Byte aus.
  - **Neuer Diagnostik-Kanal `severity` (error/warn)** quer durch die Pipeline
    (`CompileError`, Build-Service, Output-Konsole mit eigenem `warn`-Stil in Kupfer).
    Nur echte Fehler brechen den Build ab. (Fundament für die spätere Diagnostik-Stufe.)
  - **`Dim`-Arrays (1D + 2D).** `Dim punkte.b[10]` und `Dim feld.b[40, 25]` →
    C-Array mit dem Element-Typ aus dem Suffix, **auf Datei-Ebene** (static — ein
    Spielfeld-Array ist zu groß für den winzigen 6502-Stack). 2D wird als flacher
    Block `[(breite)*(hoehe)]` abgelegt; der Index `feld[spalte, zeile]` rechnet
    `zeile*breite+spalte` (Spalte zuerst, Zeile zweite — §C). Erst korrekt, die
    konstante Multiplikation optimiert cc65 `-O` (eigene Shift-Optimierung später).
    Array-Index funktioniert als Lese-Ausdruck **und** als Zuweisungsziel
    (`feld[s,z] = 1`); die Verkleinerungs-Warnung greift auch beim Byte-Array-Element.
    `Const`-Dimensionen (`Dim feld.b[BREITE, HOEHE]`) erlaubt. Ein Zugriff auf ein
    nicht mit `Dim` deklariertes Array meldet ehrlich einen Fehler + `/* TODO */`.
  - **Höchstens 2 Dimensionen — kosten-ehrlich begrenzt.** 3D und mehr melden einen
    erklärenden Fehler (der 6502 hat keine Hardware-Multiplikation → jeder nD-Zugriff
    bräuchte mehrere Multiplikationen, und nD lädt zu RAM-Explosionen ein). Der
    Workaround steht in der Meldung (2D + dritte Dimension selbst in den Index rechnen,
    Kosten sichtbar). Unterschied zu BASSM/Amiga: dort gibt es `MULU` in Hardware, darum
    war nD billig — auf dem C64 wäre es die versteckte-Kosten-Falle (Sprachdef §C).
  - **Records (`Type`/`Field`/`EndType`).** Ein benannter Verbund zusammengehöriger
    Felder → C-`struct`. `Type Slot : Field item.b : Field count.w : EndType` erzeugt
    `struct Slot { unsigned char item; unsigned int count; };`. `Dim tasche.Slot[20]` →
    `struct Slot tasche[20]` (Datei-Ebene). Feldzugriff per Backslash
    `tasche[3]\count` → `tasche[3].count`, als Lese-Ausdruck **und** Zuweisungsziel;
    die Verkleinerungs-Warnung greift auch beim Byte-Feld; ein unbekanntes Feld meldet
    einen Fehler. **Lexer erweitert:** neues `\`-Token (Feldzugriff, bewusst Backslash
    statt Typ-Punkt → keine Kollision mit `.b`/`.w`) und Erkennung des
    Record-Typ-Suffixes `.Slot` (ein record-blinder Vorab-Durchlauf sammelt die
    `Type`-Namen, der echte Durchlauf bindet `.Name` nur an einen bekannten Record —
    ein vertippter Typ fällt so auf). **Auf echter cc65 verifiziert** (gültiges
    341-Byte-`.prg`); SSOT-Einträge `Type`/`Field`/`EndType` jetzt `proven`.
  - **Stufe 1 ist damit (bis auf String-Puffer `$[N]`) vollständig:** Typ-Inferenz,
    Global, Const, Dim 1D/2D, Records, Verkleinerungs-Warnung. String-Puffer folgen mit
    der String-Stufe; `$`-Variablen sind bis dahin ein `char[1]`-Platzhalter.
    (+37 Vitest grün insgesamt für Stufe 1 — 117 Tests gesamt.)
- **Asset-IO: Char-Sets & Paletten werden ins Projekt gespeichert (Disk, nicht mehr
  localStorage).** Löst die dokumentierte Asset-IO-Schuld EINMAL für alle Asset-Arten
  (ASSET_IO.md):
  - **Projekt-gebunden statt app-global**: Das Char-Set liegt jetzt als `.petscii`-
    Datei im Projektordner, die Palette als `.palette`, beide im **`.bread`-Manifest**
    referenziert (`assets: { palette, charsets[], tilemaps[] }`, rückwärtskompatibel
    gelesen). Zwei Projekte teilen sich keine Assets mehr.
  - **`.petscii` speichert rohe C64-Bytes** (8 Bytes/Zeichen, 256 dichte Slots,
    PETSCII_FORMAT.md) — C64-export-fertig. Neuer Index↔Bytes-Konverter
    (`pixel-engine/charsetBytes.ts`, Hi-Res-Pfad), **+7 Vitest** (Bit-Reihenfolge
    MSB-links, Round-Trip).
  - **Generischer Asset-IO im Main-Prozess** (`assets:read`/`write`/`list`): schreibt
    Dateiinhalt + hält das Manifest in Sync, C64-agnostisch — eine Flow für
    `.palette`/`.petscii`/`.tilemap` (DRY). Renderer-Serialisierung in
    `stores/assetIo.ts`.
  - **Auto-Save (debounced, ~600 ms) UND manueller Speichern-Button** mit
    **Dirty-Indikator** je Editor (PETSCII-Tab-Strip + Palette-Header). Assets werden
    beim Projekt-Open automatisch von Disk geladen.
  - **localStorage-Persistenz für Palette/Charset entfernt** (alte Test-Pixel werden
    verworfen — frischer, projekt-gebundener Start).
- **Rechteck-Werkzeug mit Modus-Splitter (Rahmen / gefüllt).** Statt eines fünften
  Tools bietet der Rechteck-Button — Aseprite-Stil — ein kleines Aufklappmenü an der
  Ecke (Caret): Rahmen oder gefüllt. Der Button merkt sich die zuletzt gewählte
  Variante (sein Icon spiegelt sie); Klick aktiviert sie direkt. Engine: neuer
  `ToolId` `rectFill` (die `rect`-Tool-Logik konnte Füllung schon, nur die UI reichte
  sie nicht durch); +1 Vitest. Der Variant-Mechanismus in `<PixelToolbar>` ist
  generisch — weitere Tools können später Varianten bekommen.
  - Das Aufklappmenü zeigt nur **Icons** (Tooltip per `title`), klappt **nach links**
    auf (zur Bildmitte, weg vom rechten Rand), und das **Werkzeug-Panel erzwingt jetzt
    eine Mindesthöhe**, die alle Werkzeuge + Undo/Redo ohne Scrollen zeigt — auch eine
    zuvor zu klein gespeicherte Panel-Höhe wird einmalig hochkorrigiert
    (`panels.ensure` mit `minSizes`).
- **Geteilte Pixel-Engine — erster Konsument: PETSCII/Charset-Editor.** Der Editor
  malt jetzt richtig (Stift/Linie/Rechteck/Füllen + Undo/Redo), getragen von einer
  wiederverwendbaren Engine (memory breadcraft-pixel-engine, PETSCII_EDITOR.md §8):
  - **`src/renderer/src/pixel-engine/`** — headless TypeScript, **kein Vue**:
    `PixelGrid` (W×H, Farb-Index 0–3 pro Zelle), Tools `drawPixel`/`line` (Bresenham)/
    `rect` (Rahmen+gefüllt)/`fill` (Flood-Fill), `History` (Undo/Redo, pro Sitzung),
    und die `PixelEngine`-Fassade mit Stroke-Lebenszyklus (ein Freihand-Drag = EIN
    Undo-Schritt; Linien/Rechteck-Vorschau wird beim Weiterziehen sauber zurückgesetzt).
    **16 Vitest-Tests grün** — die Logik ist getestet, ohne dass ein Pixel gerendert
    werden musste (der Gewinn der headless-Trennung).
  - **`<PixelCanvas>`** — rendert das Grid + Maus-Picking; die EINE Stelle, die
    `pixelAspect` kennt (1 = Hi-Res 1:1, 2 = Multicolor-Doppelpixel 2:1 — der
    WYSIWYG-Träger, Leitsatz §8). DPaint-Maus: links malt den aktiven Stift, rechts
    den Hintergrund (Radieren). Besitzt die Engine-Instanz, damit die Hülle dünn bleibt.
  - **`<PixelToolbar>`** — die geteilte Werkzeugleiste (Draw/Line/Rect/Fill + Undo/Redo),
    EIN Ort für Icons/Styling; alle Pixel-Editoren binden sie ein.
  - **Pixel-Datenmodell auf Farb-Index 0–3 umgestellt** (vorher Pen-Keys): der
    `charset`-Store speichert Indizes (Hi-Res 0/1, MC 0–3); die Hülle mappt
    Index→Rolle→Hex. So bleibt die Engine C64-blind und für Sprite/Bitmap erbbar.
    Alte gespeicherte Charsets werden beim Laden migriert (Pen-Key → Index).
  - **`TilesetView` ist jetzt die dünne Hülle**: bindet Toolbar+Canvas ein, liefert
    8×8 + die Index→Hex-Palette aus der Projekt-Palette, reicht Updates an den Store.
    Navigator, Pen-Rollen, „X/256"-Zähler und der MetaTiles-Tab bleiben Hülle.
  - **Multicolor ist im Datenmodell + Canvas vorgesehen** (Index 0–3, `pixelAspect`),
    aber noch nicht scharf geschaltet — das echte Umschalten (4×8-Aufspannung, 2:1
    sichtbar) kommt mit der Grafik-Modus-SSOT. Ebenfalls offen (nächster Schritt):
    Mittelklick-Rollenmenü, Nachbar-Vorschau, `.petscii`-IO, State-Persistenz.
- **Zen-Modus für die Grafik-Editoren („Ansicht maximieren").** Ein Umschalt-Button
  in der Toolbar blendet die Seiten-Panels (Projekt-Explorer, Outliner, Output-Konsole)
  aus, damit der aktive Editor volle Breite bekommt — „mehr Editor, weniger IDE".
  - **Toolbar bleibt** (Navigation/Build griffbereit) und **HealthBars bleiben**
    (Kosten-Ehrlichkeit immer sichtbar, memory breadcraft-health-bars).
  - **Nur in den Grafik-Editoren** angeboten und wirksam (palette/tileset/tilemap/
    sprite/sound) — die Code-View behält stets ihre Panels. Der persistierte
    Zen-Wunsch bleibt gemerkt, ist aber außerhalb der Editoren inert, sodass man
    nie panel-los festsitzt. Editor-Routennamen als eine geteilte Konstante
    (`EDITOR_ROUTE_NAMES` im Router), die Toolbar und App teilen (kein Drift).
  - **Persistiert** (`zen` im `ui`-Store/localStorage; persist-everything-Regel).
  - Erste Stufe eines dreistufigen Plans (Zen → Vollbild-View → eigenes Fenster);
    verbaut die nächsten Stufen nicht.
- **Lokalisierung der IDE (vue-i18n) — Deutsch & Englisch.** Die gesamte Oberfläche
  läuft jetzt über eine i18n-Engine statt hartcodierter Texte:
  - **Eine Engine für alles** (`src/renderer/src/i18n/`): vue-i18n mit einem
    gemergten Message-Baum pro Sprache. UI-Strings liegen in
    `messages/ui.<locale>.json`, die Sprach-Vokabeltexte in `messages/lang.<locale>.json`.
    Ein SSOT-Walker (`ssotMessages.ts`) sammelt die `i18nKey`s aus
    `breadcraft.lang.json` und validiert die `lang.*`-Texte dagegen — so deckt **ein**
    `t()`-Lookup UI **und** SSOT-Vokabular ab.
  - **Deutsch ist Quellsprache, Englisch der Fallback**: ein fehlender Key löst auf
    Englisch auf.
  - **Erststart-Sprache aus dem OS abgeleitet** (`src/main/config.ts`,
    `deriveSystemLocale`/`resolveLanguage`): Systemsprache Deutsch ⇒ `de`, jede
    andere **und** nicht ermittelbar ⇒ `en`. Die Wahl wird **einmal** persistiert
    (neuer Config-Key `language`, IPC `settings:language`); danach gilt die gespeicherte
    Auswahl.
  - **Sprache im globalen Settings-Modal umschaltbar** (neue Kategorie „Sprache",
    de/en); der Wechsel wirkt **sofort** und wird persistiert (Draft/apply wie bei
    den übrigen Einstellungen).
  - **Alle Views/Components migriert** (Toolbar, Settings, Projekt-Explorer, Palette-,
    PETSCII-Tiles-, Sprite-, Sound-, Tilemap-Editor, Welcome, Outliner, Output-Konsole,
    Health-Bars, Workspace-Setup). Der **Palette-Store** trägt die 16 C64-Farbnamen
    nicht mehr als deutsche Strings, sondern als `i18nKey` (`color.*`) — die View
    übersetzt sie über die `lang.*`-Texte; Slot-Labels/Hints ebenso über i18n-Keys.
  - **`lang.*` vorerst nur die 16 Farbnamen** befüllt (im Palette-/Sprite-Editor
    sichtbar); die übrigen ~180 SSOT-Beschreibungstexte (Befehle/Parameter) folgen,
    wenn sie im UI (Hover/Doku) gebraucht werden. Englische Übersetzungen der
    UI-Strings sind vollständig hinterlegt.
- **Sprachumfang-Übersicht** (`_plans/BREADCRAFT_SPRACHUMFANG.md`): eine vollständige,
  nach logischen Kategorien geordnete Referenz des gesamten BreadCraft-Sprachumfangs
  (Datentypen, Kontrollstrukturen, Deklarationen, Grafik/Setup, Tiles, Sprites,
  Eingabe, Frame, Mathe/String, Programmfluss/Asm-Ventil, Operatoren, Konstanten/Enums).
  Aus der SSOT (`_plans/breadcraft.lang.json`) zusammengetragen; jeder Eintrag mit
  Art (function/command/keyword), Frame-Tauglichkeit, Kosten-Klasse und Status
  (bewiesen vs. geplant). Eigener Abschnitt trennt den **geplanten** Umfang (SSOT)
  vom **real implementierten** Transpiler-Slice; Anhang vermerkt die offenen Lücken
  (Sound/SID, Persistenz, vollständige `Key`-Belegung). **Diese Datei ist bei jeder
  Änderung am Sprachumfang aktuell zu halten** (Spiegel der SSOT).
- **Transpiler-Roadmap** (`_plans/BREADCRAFT_TRANSPILER_ROADMAP.md`): Lücken­analyse
  (was der CodeGen heute kann vs. Phase-1-Soll der Sprachdefinition) plus ein
  gestaffelter Weg zur vollständigen Phase-1-Übersetzung (Typsystem → Grafik →
  Sprites/Eingabe → Funktionen → restliche Built-ins → Strings → Daten/Module/Asm →
  Diagnostik). Definiert „Phase-1-vollständig" + Done-Kriterien.
- **Transpiler Schritt 3: CodeGen + „Build & Run" (die ganze Kette läuft).**
  BreadCraft erzeugt jetzt aus einer `.crumb`-Datei lauffähigen C64-Code:
  - **CodeGen** (`src/transpiler/codegen/`): AST → cc65-C, angelehnt an
    `_preflight/game.c`. `BorderColor`→`bordercolor()`, `Cls`→`bgcolor()+clrscr()`,
    `DrawText`→`cputsxy()`, Farbkonstanten→`COLOR_*`; Kontrollfluss→`if/while/for/
    do-while/break`; die Frame-Schleife `While 1` bekommt `waitvsync()`. Erzeugt
    den vollständigen `main()`-Rahmen mit conio/c64-Includes. Unbekannte Befehle
    werden ehrlich als Fehler + `/* TODO */` markiert statt still zu scheitern.
  - **`compile(source, vocab)`** (`src/transpiler/index.ts`): die ganze Pipeline
    (lex→parse→codegen) in einem Aufruf, mit gesammelten, stufenmarkierten Fehlern.
  - **Build-Service** (`src/main/build.ts`): transpiliert die aktive `.crumb`,
    schreibt `build/main.c`, ruft das **gebündelte** `cl65` (`-t c64 -O`) zu
    `build/main.prg` und startet das `.prg` in VICE (Pfad aus den Einstellungen).
    Ohne VICE-Pfad wird trotzdem gebaut und ein Hinweis gezeigt + Einstellungen
    angeboten.
  - **„Build & Run"-Knopf** ist verdrahtet; die **Output-Konsole** zeigt jetzt
    echte Build-Phasen/Logs (statt des Platzhalters), mit Leveln (Befehl/ok/Fehler)
    und Auto-Scroll.
  - Verifiziert **auf echter Hardware-Emulation**: das `PipelineDemo`-Projekt
    (`Graphics TEXT`/`Cls BLUE`/`DrawText`/`For…Next`/`If…Then`/`While 1…Wend`)
    wurde per „Build & Run" in der IDE gebaut und in VICE ausgeführt — blauer
    Schirm, „HELLO BREADCRAFT", zehn Textzeilen aus der For-Schleife und ein
    grüner Rahmen (vom `If` gesetzt). Erste sichtbar laufende BreadCraft-Erzeugung.

### Behoben
- Build (electron-vite): `main` und `preload` hatten keine Pfad-Alias-Auflösung
  für `@plans`/`@shared`/`@transpiler` — der neue Build-Service im Main-Prozess
  konnte `@plans/breadcraft.lang.json` nicht auflösen (Rollup-Fehler). Aliase pro
  Prozess in `electron.vite.config.ts` ergänzt. (TS kannte die Aliase über die
  tsconfig, der Bundler nicht — beide Auflösungswege müssen sie kennen.)
- **Transpiler Schritt 2b: Kontrollfluss im Parser.** Der Parser versteht jetzt
  Verzweigung und Schleifen — `If` in beiden Formen (einzeilig `If c Then stmt`
  und mehrzeilig `If … ElseIf … Else … EndIf`), `While … Wend` (inkl. der
  Frame-Schleife `While 1`), `For … To … [Step …] … Next`, `Repeat … Until` und
  `Exit`. Beliebig verschachtelbar. Ein fehlender Block-Abschluss (z. B. `Wend`)
  wird mit Position gemeldet, ohne Absturz; noch nicht unterstützte Keywords
  (`Select`, `Function`, …) melden weiterhin ehrlich „noch nicht unterstützt".
- Sprach-Vokabular: die Schlüsselwörter `To`, `Step` und `Then` ergänzt — sie
  fehlten in der SSOT, ohne sie ließen sich `For … To … Step …` und
  `If … Then …` nicht erkennen.
- **Transpiler Schritt 2: der `.crumb`-Parser** (Token-Strom → AST). Echte Parser-
  Architektur — rekursiver Abstieg auf Statement-Ebene plus ein Pratt-
  Ausdrucksparser mit korrektem Operator-Vorrang (Sprachdef §D) — vorerst minimal
  befüllt: Befehls-Anweisungen (`Graphics TEXT`, `DrawText 5,5,"Hi"`),
  Zuweisungen (`score.w = 10 + 5 * 2`) und volle Ausdrücke (Zahlen dez/hex/binär,
  Strings, Konstanten, Variablen mit Typ-Suffix, Funktionsaufrufe wie `Left$(s$,3)`,
  Klammer-Gruppierung). Der Parser wirft nie: Fehler werden mit Position gesammelt,
  danach wird zur nächsten Anweisung weitergeparst; eine noch nicht unterstützte
  Anweisung (z. B. `If …`) meldet das ehrlich statt still zu scheitern.
  (`src/transpiler/parser/`, 12 Tests.) Kontrollfluss/Deklarationen folgen.
- **Gebündelter cc65-Compiler.** Die zlib-lizenzierte cc65-Toolchain (cl65 V2.19)
  liegt unter `resources/cc65/` (`bin`/`lib`/`include`/`target`/`cfg`/`asminc` +
  `LICENSE`) und wird mit BreadCraft ausgeliefert — die IDE ist damit
  selbstgenügsam: der Nutzer installiert keinen Compiler und gibt keinen Pfad an.
  Ein echter Build-Test (C → C64-`.prg`) mit dem gebündelten `cl65` ist erfolgreich.
- **Toolchain-Pfadauflösung** (`src/main/toolchain.ts`): `cc65Root()`/`cc65Tool()`
  finden den gebündelten Compiler in beiden Welten — im Dev-Modus unter
  `resources/cc65`, in der gepackten App unter `process.resourcesPath/cc65`.
- **Packaging mit electron-builder** (`electron-builder.yml`, Scripts `dist` /
  `dist:dir`): erzeugt aus dem electron-vite-Build ein auslieferbares Windows-
  Paket (NSIS-Installer + portable EXE) und kopiert `resources/cc65` via
  `extraResources` ins Paket.
- **Transpiler-Grundstein: der `.crumb`-Lexer** (erster Schritt der Sprach-
  Pipeline `.crumb` → C → `.prg`). Ein eigenständiger, SSOT-gespeister Lexer
  (`src/transpiler/lexer/`) zerlegt Quelltext in einen klassifizierten Token-
  Strom (Kommentar, Text, Dezimal-/Hex-/Binärzahl, per Sprachvokabular
  klassifizierte Bezeichner, Operatoren, Klammern, Typ-Suffixe `.b`/`.w`/`$`,
  Zeilenumbrüche) mit Zeile/Spalte/Länge je Token. Unbekanntes (z. B. ein nicht
  geschlossener Text) wird zu einem Fehler-Token mit Position — der Lexer wirft
  nie. Welches Wort ein Befehl/Funktion/Konstante ist, entscheidet
  ausschließlich die SSOT (kein hartcodiertes Vokabular).
- **Test-Infrastruktur:** Vitest eingerichtet (`npm run test`), mit 16 Lexer-
  Tests gegen das echte Sprachvokabular.
- **Geteilte Sprach-Grundlage:** die SSOT-Typen und der Vokabular-Aufbau
  (`buildVocabulary`) liegen nun unter `src/shared/` (`ssot-types.ts`,
  `vocabulary.ts`) — EINE lexikalische/vokabuläre Wahrheit, die sich Editor
  (Monaco) und Transpiler teilen. (Monacos Syntax-Highlighting ist bewusst
  unverändert; seine Umstellung auf den neuen Lexer ist ein späterer Schritt.)
- Lexer kennt den **Statement-Trenner `:`** (mehrere Anweisungen pro Zeile, z. B.
  `If x > 10 : DrawText 2, 2, "Hi" : EndIf`) als eigenes Token.

### Geändert
- **Sprache: String-Funktionen tragen jetzt das BASIC-`$`-Suffix** —
  `Left$`, `Right$`, `Mid$`, `Str$`, `Chr$`. Grund: `Left`/`Right` kollidierten
  case-insensitiv mit den Joystick-Konstanten `LEFT`/`RIGHT` (`JoyDir`), sodass
  Lexer/Editor sie kontextfrei nicht trennen konnten. Das `$` macht den Namen
  eindeutig und ist zugleich vertraute BASIC-Schreibweise. Regel: jede Funktion
  mit String-Rückgabe trägt `$`; zahl-rückgebende (`Int`, `Find`, `Asc`, `Len`)
  nicht. Ausnahme `GetMetaTile` (MetaTile-Namens-ID) bleibt ohne `$` — Symmetrie
  zu `SetMetaTile`, keine Kollision. Eine **vollständige SSOT-Prüfung auf weitere
  case-insensitive Schlüssel-Kollisionen** ergab danach: keine mehr (`Text`/`TEXT`,
  `Left`/`LEFT`, `Right`/`RIGHT` waren alle).
- Der Lexer entscheidet ein angehängtes `$`/`.b`/`.w` jetzt **anhand der SSOT**:
  Ist `name$` ein bekannter Vokabel-Name (z. B. `Left$`), bleibt es **ein** Token
  (Funktion); sonst ist `$` ein Typ-Suffix der Variable (`name$` = Identifier +
  Suffix). So bleibt `Left$` als Funktion von der Konstante `LEFT` getrennt.
- **Sprache: Befehl `Text` → `DrawText` umbenannt.** `Text` kollidierte
  case-insensitiv mit der Grafikmodus-Konstante `TEXT` (aus `Graphics TEXT, …`),
  sodass Lexer und Editor die beiden ohne Grammatik-Kontext nicht eindeutig
  trennen konnten — besonders mitten in der Zeile (nach `:`). `DrawText` beseitigt
  die Kollision strukturell und reiht sich in `DrawMap`/`DrawImage` ein. Betrifft
  SSOT (`breadcraft.lang.json`, stabile id `cmd-text` bleibt) und die formale
  Sprachdefinition; der Editor bietet künftig `DrawText` an. Kein `Text`-Alias
  (der würde die Kollision zurückholen).

- **Globales Einstellungs-Modal** (Zahnrad in der Toolbar): links eine Liste der
  Konfigurations-Kategorien, rechts deren Optionen, unten rechts „Übernehmen" /
  „Abbrechen", oben rechts ein Schließen-Icon. Änderungen leben als Entwurf und
  werden erst bei „Übernehmen" gespeichert; „Abbrechen"/Schließen verwirft sie.
  - Kategorie **Allgemein:** Startverhalten (`startupMode`) ist nun in der UI
    einstellbar (vorher nur über die Konfigurationsdatei).
  - Kategorie **Emulator (VICE):** Pfad zur VICE-Programmdatei (`x64sc`)
    festlegen — per Eingabe oder Datei-Dialog. Der Pfad wird sofort geprüft
    (existiert die Datei? sieht der Name nach `x64sc` aus?) und mit einem
    grün/gelb/rot-Hinweis quittiert. Damit kann ein gebautes Programm später
    direkt im vorhandenen VICE getestet werden, bis der eingebettete Emulator
    angebunden ist.
- Persistenz: Der VICE-Pfad wird (wie alle App-Einstellungen) in der userData-
  Konfiguration abgelegt und überdauert Neustarts.

### Behoben
- Lexer: Zeilenkommentar ist jetzt `;` (Sprachdef §B), nicht mehr `'`. Ein
  einzelnes `'` ist damit kein Sonderzeichen mehr.
- Sprach-Vokabular: der Operator-Block der SSOT (`operators[]`) wurde von
  `buildVocabulary` bisher **nicht** eingelesen — die Wort-Operatoren `And`, `Or`,
  `Mod`, `Xor`, `Not`, `Shl`, `Shr` waren dem Editor und dem Lexer unbekannt
  (wurden als gewöhnliche Bezeichner behandelt). Jetzt sind sie Teil des
  Vokabulars; davon profitieren Lexer/Parser **und** das Monaco-Highlighting.
- Syntax-Highlighting: Konstanten, die in der SSOT auch als Befehl/Funktion
  vorkommen (`TEXT`, `LEFT`, `RIGHT`), wurden uneinheitlich gefärbt (z. B. `TEXT`
  blau wie ein Befehl, `MULTICOLOR` orange wie eine Konstante). Konstanten werden
  jetzt vorrangig erkannt → einheitliche Färbung.

### Hinzugefügt
- Outliner listet die benutzerdefinierten `Function`-Definitionen des aktiven
  `.crumb` und unterscheidet „Function" (mit Rückgabetyp-Suffix `.b`/`.w`/`$`)
  von „Statement" (ohne Suffix, ohne Rückgabewert); per Klick springt der Editor
  zur Zeile. (Heuristischer Zeilen-Scan; wird später durch den echten Parser/AST
  ersetzt.)

### Geändert
- Startseite: Logo deutlich vergrößert; der separate „Advanced Retro-Tech"-Schriftzug
  darunter entfernt (ist bereits Teil des Logos).

### Entfernt
- Statusleiste: erfundene Mockup-Platzhalter entfernt („Arc live"-Puls-Indikator,
  „Frame-Budget", „RAM", feste Zeile/Spalte) — sie täuschten echte Messungen vor.
  Verbleiben: Projektname, aktive Datei, Plattform-Hinweis.
- Konsole: erfundene Build-/Run-Log-Zeilen und die „2 Hinweise"-Plakette entfernt;
  zeigt nun einen ehrlichen Leerzustand (es gibt noch keinen Build/Emulator).
- Health-Bars: Fantasie-Werte (RAM 38 %, Raster 23 %) entfernt; zeigen „—" und
  einen „noch keine Daten"-Hinweis, bis echte Werte aus cc65-Map (RAM) bzw.
  Emulator-Messung (Perf) vorliegen.
- Konsole: funktionslose Mockup-Tabs „Validierung" und „Terminal" entfernt
  (Terminal passt nicht ins Konzept; „Validierung" kehrt zurück, sobald die
  Validierungs-Stufe echte Warnungen liefert). Kopf zeigt nur noch „Output".

## [0.1.0] - 2026-05-28

Erste interne Grundlage — die App-Hülle und der Datei-/Editor-Unterbau stehen,
ohne dass BreadCraft schon ein lauffähiges C64-Programm erzeugen kann.

### Hinzugefügt
- **Electron-Anwendung** mit Vue 3, Pinia und Vue-Router, gebaut über electron-vite
  (TypeScript). Main-/Preload-/Renderer-Aufteilung.
- **Design-System-Anbindung:** das BreadCraft-Design-System (Farben, Typografie,
  Inter-Fonts, Tokens) ist in den Renderer eingebunden; die IDE-Oberfläche
  (Toolbar, Explorer, Outliner, Health-Bar-Leiste, Konsole, Statusbar) folgt dem
  HTML-Mockup-Layout.
- **Einklapp- und skalierbare Panels:** Projekt-Explorer, Outliner und Konsole
  lassen sich einklappen und per Ziehgriff in der Größe ändern; die Health-Bars
  sind bewusst fix.
- **Monaco-Editor** lokal gebündelt (kein CDN), mit eigenem BreadCraft-Dark-Theme.
- **`.crumb`-Sprachunterstützung aus der SSOT** (`breadcraft.lang.json`):
  - Intellisense-Autovervollständigung (Keywords, Befehle, Funktionen, Konstanten).
  - Auto-Schreibweise: getippte Bezeichner werden auf die kanonische Schreibweise
    normalisiert.
  - Syntax-Highlighting, das ausschließlich echte SSOT-Namen einfärbt.
- **Arbeitsverzeichnis-Einrichtung beim ersten Start:** Onboarding-Dialog
  (Vorschlag `Dokumente/BreadCraft`, frei wählbar) legt die Ordner `temp/` und
  `projects/` an.
- **Datei-Layer / Projekt-Modell:**
  - Minimales `.bread`-Projektformat (Name, Einstiegs-Crumb, Crumb-Liste,
    Asset-Platzhalter).
  - Temporäre Projekte unter `temp/`, feste Projekte unter `projects/`.
  - Projekt öffnen, Crumb-Dateien laden, im Editor bearbeiten, mit `Strg+S`
    speichern (Dirty-Markierung), neue Projekte/Dateien anlegen.
- **Startverhalten (konfigurierbar, noch ohne UI):** Einstellung `startupMode`.
  - `welcome` (Standard): Startseite mit Logo und Liste „Zuletzt verwendet".
  - `last`: zuletzt geöffnetes Projekt automatisch wiederherstellen.
- **Recent-Projects-Liste:** feste Projekte werden gemerkt (neueste zuerst,
  begrenzt; temporäre Projekte ausgenommen).
- **Persistenz:** UI-Layout (Panel-Größen, Collapse-Zustand) und App-Einstellungen
  (Arbeitsverzeichnis, Startmodus, Recent-Liste) überdauern Neustarts.

### Bekannte Einschränkungen
- Kein Transpiler/Build zu C64-`.prg` (Sprach-Pipeline noch nicht gebaut).
- Keine Asset-Editoren (Tileset/Tilemap/Sprite/Palette/Sound) — nur Platzhalter.
- Keine Settings-UI; `startupMode` nur über die Konfigurationsdatei änderbar.
- Health-Bars zeigen Beispielwerte, keine echte Messung.
- Alle Oberflächentexte sind hartcodiert deutsch (Lokalisierung folgt).

[Unreleased]: https://example.invalid/breadcraft/compare/v0.1.0...HEAD
[0.1.0]: https://example.invalid/breadcraft/releases/tag/v0.1.0
