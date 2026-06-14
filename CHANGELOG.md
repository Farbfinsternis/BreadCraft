# Changelog

Alle nennenswerten Änderungen an BreadCraft werden in dieser Datei festgehalten.

Das Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
die Versionierung an [Semantic Versioning](https://semver.org/lang/de/).

## [Unreleased]

### Hinzugefügt
- **Endlich Zahlen auf dem Schirm: ein Punktestand, der sich auch ändert.** Bisher konnte `DrawText`
  nur fest getippten Text zeigen — eine Variable hinzuwerfen (`DrawText 7, 1, score`) ergab Kauderwelsch
  oder gar nichts, weil der C64 eine Zahl nicht für Text hält. Jetzt wandelt BreadCraft eine Zahl an
  dieser Stelle automatisch in ihre Ziffern um (über `Str$`, das es ab sofort auch direkt gibt): `Str$(n)`
  liefert den Text zu einer Zahl, und `DrawText` schluckt eine Zahl genauso bereitwillig wie ein Wort.
  Damit kommt der erste echte HUD-Wert — Score, Leben — sichtbar ins Spiel. (Das ist der erste Schritt
  der String-Stufe; echte Text-Variablen `$[N]` und das Zusammenkleben von Strings folgen.)

### Geändert
- **Die PERF-Bar sagt jetzt, wann das Frame überläuft — nicht nur, dass es eng wird.** Bisher wurde
  ein zu teures Frame einfach ein roter Balken bei 100 % — ununterscheidbar von „RAM voll", und der
  eigentliche Punkt blieb stumm. Jetzt hat der Überlauf einen eigenen, lesbaren Zustand: **„FRAME
  VOLL — deine Logik passt nicht in ein Frame → VWait halbiert still auf 25 fps"**, und der Prozent-
  Wert wird ehrlich *nicht* mehr bei 100 % gedeckelt (ein überfülltes Frame liest sich als „~135 %",
  der Balken bleibt voll). Es bleibt eine Schätzung aus dem Code (das `~` sagt es) — kein neuer
  Messmechanismus, nur eine ehrliche Anzeige obendrauf. Die ganze PERF-Zeile folgt jetzt zudem der
  UI-Sprache (auch das vorher hart deutsche „Takte/Frame … · geschätzt").

### Behoben
- **Die Konsole spricht jetzt wirklich komplett Deine Sprache.** Die Compiler-Fehler folgten zwar
  schon der UI-Sprache (0.2.2), aber alles *drumherum* in der Ausgabe-Konsole war fest auf Deutsch
  verdrahtet: „Transpiliere …", „Build erfolgreich →", die RAM-Zeile, „Starte VICE", „VICE gestartet"
  — und sogar die Begründung einer Verkleinerungs-Warnung („ein vorzeichenbehafteter Wert (.i) wird
  unsigned …") rutschte deutsch durch, während der Satz drumherum schon englisch war. In einer
  englischen IDE war das eine Wand aus Fremdsprache. Jetzt folgt **jede** Konsolen-Zeile der UI-Sprache
  — die Build-Orchestrierung und die letzten drei deutschen Warnungs-Begründungen inklusive. Der
  deutsche Wortlaut bleibt Wort für Wort, das Englische kommt sauber dazu.

## [0.2.2] - 2026-06-13

### Behoben
- **Die freie Tile-Farbe landet jetzt auch in VICE, nicht nur im Editor.** Im Tilemap-Editor
  durftest du für jede 8×8-Zelle die freie vierte Multicolor-Farbe (das Color-RAM) wählen, und im
  Editor sah das hübsch aus — beim Build auf den echten C64 war dann aber alles einheitlich grau.
  Der Grund: `DrawMap` stempelte stur eine feste Farbe in jede Zelle und warf die gemalten Farben weg
  (ein „kommt später"-Platzhalter). Jetzt liest der Asset-Resolver die `colors` aus der `.tilemap` mit
  und `DrawMap` backt sie — mit gesetztem Multicolor-Bit — Zelle für Zelle ins Color-RAM. Was du malst,
  siehst du auch im Emulator. Alte `.tilemap`-Dateien ohne Farben fallen sauber auf den Standard zurück.
- **Die freie Tile-Farbe zeigt jetzt nur noch die 8 Farben, die der C64 wirklich kann (Kosten-Ehrlichkeit).**
  Der Editor bot für die freie vierte Multicolor-Farbe alle 16 C64-Farben an — aber im Multicolor-Text-Modus
  stammt diese Farbe aus den unteren **drei** Bits des Color-RAM, also kann sie nur eine der **ersten 8**
  Farben sein. Hellgrau, Dunkelgrau & Co. hätte der echte C64 stillschweigend durch ihren 3-Bit-Zwilling
  ersetzt (Hellgrau → Gelb, Dunkelgrau → Cyan). Statt diese Lüge im Editor stehenzulassen, bietet die
  Color-RAM-Palette jetzt genau die 8 möglichen Farben an, und die Vorschau zeigt für alte Karten ehrlich,
  was wirklich erscheint. Der Standard ist jetzt Weiß (statt des unmöglichen Hellgrau).
- **Compiler-Fehler sprechen jetzt Deine Sprache — alle (STAHL S5b, komplett).**
  Die IDE kann längst Deutsch und Englisch, aber der Übersetzer brüllte jeden Fehler stur auf Deutsch
  zurück — für einen englischsprachigen Nutzer eine Wand aus Fremdsprache genau im Moment des Stolperns.
  Ab jetzt folgt **jede** Fehlermeldung der UI-Sprache: aus dem Lexer (kaputtes Zeichen, nicht
  geschlossener Text), dem Parser (fehlende Klammern, Groß-/Kleinschreibung), dem Code-Generator
  (unbekannte Funktion, Rekursion, falsche Befehls-Argumente) und beim Laden der Assets („Tileset nicht
  gefunden", „kein gültiges .petscii" …) — Englisch in der englischen IDE, Deutsch in der deutschen. Der
  deutsche Wortlaut bleibt Wort für Wort wie zuvor, das Englische kommt sauber dazu. (Befund 5b)
- **Der „Build"-Knopf tut jetzt etwas (EISEN M4.T2).** Neben „Build & Run" saß ein zweiter,
  gleich großer „Build"-Knopf — der aber an gar nichts hing: ein Klick, und nichts geschah. Jetzt
  baut er die aktive `.crumb` bis zur fertigen `.prg` durch (gebündelter cc65), **ohne** den Emulator
  zu starten — für den schnellen „kompiliert das überhaupt?"-Durchlauf. Fehlt ein VICE-Pfad, ist das
  hier kein Problem (es wird ja nichts gestartet) und es springt auch keine Einstellungs-Aufforderung
  auf — die kommt weiter nur bei „Build & Run". Der Tooltip sagt ehrlich, was passiert: „Baut die
  aktive Datei (ohne Start)". (Befund 8)
- **Eine Crumb aus dem Datei-Baum öffnen frisst sie nicht mehr auf (EISEN M4.T1).** Lag im Projekt
  eine `.crumb`, die BreadCraft noch nicht „kannte" (von Hand reinkopiert, mit dem Datei-Manager
  angelegt, aus einem anderen Tool) und du klicktest sie im Explorer an, ging ein **leerer** Tab auf —
  und ein beherztes Strg+S schrieb diese Leere prompt über deine echte Datei. Genau dein neues
  Hintergrund-Tile, dein zweites Level, dein reinkopierter Code: weg. Jetzt liest der Editor den Inhalt
  erst von der Platte, BEVOR der Tab aufgeht — du sieht, was wirklich drinsteht. Verschwindet die Datei
  zwischen Anzeigen und Klicken, sagt BreadCraft das ehrlich, statt einen speicherbaren Leer-Tag
  aufzumachen. Das bloße Öffnen rührt das Projekt-Manifest (`.bread`) nicht an — Öffnen ist kein
  Speichern. (Befund 7)

### Intern
- **Der Into-The-Deep-Bau-Harness läuft nicht mehr bei jedem Testlauf mit (EISEN M3.T2).** Ein
  „TEMP"-Test zog beim normalen `npm test` jedes Mal das echte ITD-Projekt über feste Maschinenpfade
  durch cl65 — praktisch als Lauf-Probe, aber auf jeder anderen Maschine/CI ein garantiertes Rot. Er
  ist jetzt aus dem Test-Glob raus, liegt als manuell aufrufbares Dev-Werkzeug in `_intern/` (nicht in
  git) und holt seine Pfade aus Umgebungsvariablen (Fallback = Dev-Layout), mit Skip statt Fehler, wenn
  die Pfade fehlen. Die normale Test-Zahl sinkt dadurch bewusst um eins. (Befund 24)
- **Ein Dateiformat, eine Wahrheit — Editor und Build lesen Deine Assets nicht mehr aus zwei
  getrennten Büchern (EISEN M3.T1).** Eine `.petscii`, `.tilemap`, `.palette` oder `.sprite` wurde
  bislang von zwei Stellen unabhängig zerlegt: der Editor las sie nachsichtig (im Zweifel leer laden,
  Wackelwerte glattbügeln), der Übersetzer streng (jeder Fehler sofort sichtbar, bevor cc65 läuft).
  Zwei Leser desselben Formats driften — und das war schon passiert (der Build kannte das Farb-Feld
  der Karte gar nicht). Jetzt liegt die *Form* des Formats an genau einer Stelle (`shared/asset-formats`):
  Feldnamen, Struktur, Maße, das zukunftssichere Ebenen-Array. Beide Seiten rufen denselben Codec und
  setzen nur noch ihre Haltung obendrauf — der Editor bleibt nachsichtig, der Build streng. Ändert sich
  ein Feld, ändert es sich für beide. (Nebenbei gefallen: der Übersetzer las eine `.sprite` nicht mehr
  zweimal, und das Karten-Farb-Feld ist jetzt sauber lösbar.) (Befund 23/25)

## [0.2.1] - 2026-06-12

### Hinzugefügt
- **Die Perf-Health-Bar lebt — sie SCHÄTZT, was Dein Crumb pro Frame kostet.** Bisher war der
  „PERF"-Balken ein totes Schaufenster (immer „—"). Jetzt zeigt er nach jedem Build eine *Schätzung*,
  wie voll ein Bild (ein Frame) wird: BreadCraft liest Deinen Code, findet die Spielschleife (die mit
  `VWait`), und extrapoliert grob, wie viele Takte ein Durchlauf kostet — inklusive der Funktionen, die er
  ruft. Ein Multiplizieren wiegt viel, ein Plus wenig, eine Schleife multipliziert ihren Rumpf; so klettert
  der Balken, *während* Du teureren Code schreibst, ohne dass Du das Spiel erst starten musst. Wichtig und
  ehrlich: es ist ein **Schätzwert, keine Messung** (das `~` vor der Prozentzahl sagt es) — genau wie in
  BASSM. Überschreitet die Schätzung ein ganzes Frame, färbt der Balken rot: dann droht der Sprung auf 25
  fps. (Das Into-The-Deep-Level liegt z. B. bei ~48 %.) (memory: c64-math-cost-model, breadcraft-health-bars)

### Behoben
- **Tile-Kollisionen tragen kein verstecktes Multiplizieren mehr — und bremsen das Spiel nicht aus.**
  Jede `TileSolid`/`TileAt`-Abfrage rechnet intern `zeile · 40 + spalte`, um die Zelle im Bildschirm-RAM
  zu finden — und 40 ist keine Zweierpotenz, also rief der Übersetzer hier seine *langsame* Software-
  Multiplikation auf (der 6502 kann nicht multiplizieren). Das fiel bei Bewegung auf: weil die Kollision
  *pro bewegtem Pixel* prüft, häuften sich die teuren Multiplikationen, der Frame platzte über einen
  Bildaufbau, und alles lief auf einmal mit halbem Tempo (am sichtbarsten an gleichmäßig laufenden
  Gegnern). Jetzt zerlegt BreadCraft das `· 40` in billige Bit-Verschiebungen (40 = 32 + 8 →
  `(zeile<<5)+(zeile<<3)`) — exakt dieselbe Optimierung, die 2D-Tabellen schon bekamen. Die Abfrage wird
  schlagartig günstiger, das `.prg` sogar kleiner (die Multiplikations-Routine fällt weg). Greift überall:
  `TileSolid`, `TileAt`, und `SetTile`/`GetTile` mit einer Variablen-Zeile. (memory: c64-math-cost-model)

### Hinzugefügt
- **`End Type` darf jetzt auch in zwei Wörtern stehen.** Die ausgeschriebenen Block-Enden waren bisher
  unvollständig: `End If`, `Else If` und `End Function` gingen, aber ausgerechnet `End Type` (das Ende
  eines Records) nicht — ein einsames `EndType` stach aus dem Zwei-Wort-Stil heraus. Jetzt versteht
  BreadCraft alle vom Sprach-Standard vorgesehenen Zwei-Wort-Formen (auch `End Select`/`End Asm` für die
  späteren Features), strikt in kanonischer Schreibweise.

## [0.2.0] - 2026-06-12

### Geändert
- **CRUMB unterscheidet jetzt Groß- und Kleinschreibung — und schenkt Dir damit Deine Wörter zurück
  (EISEN M2.T2).** Bisher war `fire` dasselbe wie `FIRE`, also durftest Du keine Variable `fire` nennen —
  der Übersetzer hielt sie für die Joystick-Konstante und verschluckte sich. Genau diese Reibung ist weg:
  ein CRUMB-Wort ist ab jetzt NUR seine eine kanonische Schreibweise. `FIRE` ist die Konstante, `If` das
  Schlüsselwort, `Next` das Schleifenende — aber `fire`, `next`, `max` (kleingeschrieben) gehören wieder
  Dir und dürfen heißen, was Du willst. Die kanonische Schreibweise selbst bleibt reserviert: schreibst Du
  versehentlich `Next = 1`, sagt BreadCraft klar „‚Next' ist ein CRUMB-Wort — schreib es z. B. klein". Und
  vertippst Du Dich in der Schreibweise eines Schlüsselworts (`if` statt `If`), rätst Du nicht mehr im
  Dunkeln: „meintest Du ‚If'? CRUMB unterscheidet Groß- und Kleinschreibung."
- **Der Editor spricht jetzt dieselbe Sprache wie der Übersetzer (EISEN M2.T2b).** Die Schreibhilfe ist
  nachgezogen: Der Editor färbt Wörter ab jetzt *case-sensitiv* — `If` leuchtet als Schlüsselwort, `if`
  oder `iff` bleiben schlichter Text, genau wie der Übersetzer sie sieht. Und vor allem hört die
  Auto-Korrektur auf, Dir Deine Variablen zu klauen: Tippst Du `vwait = 1`, bleibt es `vwait` — die
  Korrektur macht daraus nicht mehr heimlich das Schlüsselwort `VWait`. Sie greift nur noch dort, wo ein
  CRUMB-Wort eindeutig ist (eine Farbe als Argument, `Cls black` → `Cls BLACK`; ein Funktionsaufruf,
  `joystick(` → `Joystick(`) — und lässt im Zweifel die Finger davon, denn ein zerstörter Variablenname
  ist teurer als ein nicht korrigiertes Schlüsselwort. (Ein Kommentarzeichen-Rest ist dabei auch gefallen:
  der Editor erkennt jetzt `;` als Kommentar, nicht mehr das alte BASIC-Hochkomma `'` — die Färbung im
  Editor und die Regeln des Übersetzers decken sich damit endgültig.)

### Intern
- **Die Wort-Rolle wird sauber im Parser entschieden, nicht mehr mit einem Pflaster (EISEN M2.T2).** Damit
  ein Wort wie `MAX` nach `Const` als Name durchging, obwohl der alte Lexer es als Funktion einstufte, gab
  es eine Sonderliste („nimm den Namen, egal was der Lexer meint"). Die ist weg. Stattdessen gilt eine
  einzige, klare Regel: die exakte kanonische Schreibweise eines CRUMB-Worts ist reserviert, alles andere
  ist ein freier Bezeichner. Der Statement-Einstieg prüft zuerst die Zuweisungs-Form (`name = …`), dann
  Schlüsselwörter, dann Aufrufe — und ein reserviertes Wort als Ziel quittiert er mit einem präzisen
  Hinweis statt einer Allgemeinplatz-Fehlermeldung. Kein für Dich neuer Knopf, aber das Fundament, auf dem
  die einzeiligen `If`-Ketten und die vereinte Argumentliste als Nächstes stehen. (Eine Plan-Abweichung,
  bewusst für die nächste Review markiert: der ursprünglich geplante gemeinsame Namens-Knoten im
  Syntaxbaum wurde vorerst zurückgestellt — die Groß-/Kleinschreibung allein erledigt das Kernproblem;
  bessere Tippfehler-Hinweise im Übersetzer bleiben eine spätere Politur.)
- **Das Sicherheitsnetz für den Parser-Umbau ist gespannt (EISEN M0.T1).** Bevor am Herz der Sprache
  geschraubt wird, hängen jetzt 19 Architektur-Schmerzfälle als fester Test (`parser.archcases.test.ts`) —
  vom zweiwörtrigen `End If` über die Variable namens `next` bis zur einzeiligen `If…Then`-Kette. Sieben
  Fälle parsen schon heute sauber; die zwölf, die es noch nicht tun, stehen bewusst als `it.fails`: Sie
  laufen mit, MÜSSEN heute scheitern — und in der Sekunde, in der ein späterer Umbau-Schritt sie repariert,
  schlägt das Netz an und erzwingt, dass der Fall auf „muss-grün" hochgestuft wird. So kann kein
  reparierter Fall heimlich wieder verrotten. (Noch kein für dich sichtbarer Unterschied — das Netz liegt
  unter dem Boden, nicht auf der Bühne.)
- **Der Lexer hat sich dumm gestellt — und genau das ist der Fortschritt (EISEN M2.T1).** Bisher fällte
  die erste Stufe des Übersetzers, der Wort-Zerteiler, eine Entscheidung, die ihr gar nicht zustand: Sie
  versuchte schon beim Zerlegen festzulegen, ob ein Wort ein Befehl, eine Konstante oder ein Schlüsselwort
  ist — ohne den Satz drumherum zu kennen. Das ist die Wurzel einer ganzen Fehlerfamilie (warum `next` keine
  Variable sein durfte, warum `End If` in zwei Wörtern scheiterte). Jetzt reicht der Zerteiler jedes Wort
  einfach als schlichtes „Wort" weiter; *welche* Rolle es spielt, klärt der Parser, der den Kontext sieht.
  Mit umgezogen ist die Zwei-Wort-Verschmelzung (`End If` → `EndIf`, strikt nur die kanonische Schreibweise)
  und der doppelte Datei-Durchlauf für Record-Typen ist ersatzlos weggefallen. Das erzeugte C ist Byte für
  Byte dasselbe wie vorher — diese Runde legt nur das Fundament, auf dem die sichtbaren Reparaturen (`fire`
  als Variable, einzeilige `If`-Ketten) als Nächstes stehen werden. Eine bewusst kleine Abweichung vom Plan:
  der Zerteiler kennt das Vokabular noch für *eine* rein lexikalische Grenze (`Left$` bleibt ein Wort, nicht
  `Left` + `$`) — keine Grammatik-Klassifikation, nur eine Wortgrenze.

### Hinzugefügt
- **`End If`, `Else If` und `End Function` darfst Du jetzt in zwei Wörtern schreiben.** Wer aus anderen
  BASIC-Dialekten kommt, tippt die Block-Enden gern getrennt — und stieß bisher gegen eine Wand: CRUMB
  kannte nur `EndIf`, `ElseIf`, `EndFunction` am Stück, die getrennte Schreibweise war schlicht ein Fehler.
  Jetzt versteht BreadCraft beide. Eine kleine, ehrliche Grenze bleibt: verschmolzen wird nur die saubere
  Groß-/Kleinschreibung (`End If`, nicht `end if`) — damit später keine Zweideutigkeit entsteht und der
  Editor Dir bei `end if` freundlich „meintest Du `End If`?" zurufen kann. Und ein einsames `Else` auf
  eigener Zeile, gefolgt von einem `If` in der nächsten, bleibt natürlich ein verschachteltes If — nur das
  unmittelbare `Else If` in *einer* Zeile wird zusammengezogen.
- **Die RAM-Anzeige lebt jetzt — und kennt die echte Wand.** Der RAM-Balken oben war bisher nur ein
  hübsches Versprechen (er zeigte „—"). Jetzt füllt er sich nach jedem Build mit der *echten* Größe deines
  Programms — gemessen gegen die Decke, die für *dein* Projekt gilt: Benutzt du einen Zeichensatz, ist das
  die reservierte Grafik-Grenze ($3000); sonst der ganze nutzbare Speicher. Der Balken läuft gelb, wenn es
  eng wird, und rot, wenn du an die Wand stößt — du siehst also „wird voll", *bevor* der Übersetzer abbricht,
  statt überrascht zu werden. Und wenn ein Programm doch zu groß wird, sagt BreadCraft jetzt klar um wie
  viele Bytes — keine kryptische Linker-Zeile mehr.
- **Das erste echte Level läuft: gemalter Held auf gemalter Welt.** Der Bogen schließt sich — ein im IDE
  gemaltes Into-The-Deep-Level läuft als echtes CRUMB-Programm auf dem C64 (in VICE): das gemalte Tileset
  und die gemalte Karte bilden die Welt, der gemalte Spieler-Sprite springt mit der abgenommenen
  Plattformer-Physik hindurch und kollidiert gegen die festen Tiles — sauber und flüssig, alles farbtreu
  aus der Projekt-Palette. Der Clou unter der Haube: weil der Spieler jetzt ein *Sprite* ist (eigener
  Hardware-Layer) statt einer bewegten Kachel, kollidiert er nicht mehr mit sich selbst — das mühsam von
  Hand gepflegte Schatten-Array der Phase-1-Skizze fällt ersatzlos weg. Die Kollision liest direkt die
  gemalte Karte (`TileSolid`, Konvention: Kachel 0 = leer/begehbar, jede andere = fest). Das CRUMB wurde
  dadurch *kürzer*, nicht länger.
- **Die Projekt-Palette färbt jetzt wirklich.** Bisher war der Palette-Editor ein hübsches Versprechen:
  Du konntest die geteilten C64-Farben festlegen und speichern — aber das laufende Spiel scherte sich
  nicht darum, es buk stur Braun und Orange ein. Das ist vorbei. `UseTileset` und `UseSprite` lesen jetzt
  die Projekt-Palette und setzen genau die Farben, die du gewählt hast: Hintergrund und die beiden
  geteilten Register, die sich Kacheln UND Sprites von Hardware wegen teilen (eine Wahrheit fürs ganze
  Bild, kein doppelter Buchhaltungsposten). Hat ein Projekt noch gar keine Palette, greifen ehrliche
  Standardfarben statt eines Absturzes; eine kaputte Palette-Datei dagegen fällt sofort auf, statt sich
  stillschweigend wegzumogeln.
- **Sprites bekommen ihre eigene Farbe.** Ein Multicolor-Sprite hat vier Farb-Rollen: durchsichtig, zwei
  geteilte (die aus der Palette) und eine *individuelle*, die jeder Figur allein gehört. Genau die ließ
  sich bisher nicht wählen — sie war fest auf Weiß genagelt, alle Sprites gleich. Jetzt liegt im
  Sprite-Editor ein Farbfeld-Wähler für diese eine freie Farbe; sie wandert in die `.sprite`-Datei und
  von dort ins Programm. So tragen Spieler und Schleim ihre eigene Note, während die beiden geteilten
  Farben weiter projektweit gekoppelt bleiben — das Modell, das den Hybrid-Farbsprung von vornherein
  unmöglich macht, nicht bloß verbietet. (Alte `.sprite`-Dateien ohne diese Farbe lesen sich klaglos als
  Weiß — nichts geht verloren.)
- **„Neuer Sprite": eine leere Fläche zum Ausprobieren.** Der Sprite-Editor ist jetzt ein Skizzenblock.
  Ein Klick auf „Neuer Sprite" wischt die Leinwand frei — und schreibt dabei *nichts* auf die Platte. Die
  Datei entsteht erst, wenn die Skizze gut wird und du bewusst „Speichern als" wählst; verwirfst du das
  Gekritzel, bleibt keine Spur zurück. Genau so probiert man eine Figur aus, ohne sich vorab auf Name und
  Ordner festzulegen. Hat die aktuelle Zeichnung ungespeicherte Änderungen, fragt ein kurzer Dialog nach,
  bevor er sie verwirft — ein Fehlklick kostet nie Arbeit. (Dafür hat BreadCraft nun auch einen echten
  Ja/Nein-Dialog, nicht nur Eingabe und bloße Meldung.)

### Geändert
- **„Speichern als" heißt jetzt „Speichern als".** Der Knopf im Datei-Dialog trug die verwirrende
  Aufschrift „Hier speichern" / „Save here" — vertrauter und zum Dialogtitel passend ist „Speichern als" /
  „Save as".
- **Projektname schön, Ordnername sicher.** Beim Anlegen darf das Projekt einen freien Namen mit
  Großschreibung und Leerzeichen tragen (z. B. „Into The Deep") — der bleibt als Anzeigename erhalten.
  Auf der Festplatte legt BreadCraft daraus aber automatisch einen sauberen Ordner- und Dateinamen an
  („into-the-deep"): kleingeschrieben, Bindestriche statt Leerzeichen, keine Sonderzeichen. So stolpert
  später keine Werkzeugkette (Compiler, Emulator, Versionsverwaltung) über Leerzeichen im Pfad — der
  Komfort eines hübschen Titels ohne die versteckten Kosten.

### Behoben
- **Argumentlisten verstehen sich jetzt in einer Routine — und ein vergessenes Klammerpaar wird erklärt
  (EISEN M2.T4).** Drei Reibungen auf einmal geglättet: (1) Ein eigener Befehl wie `Heal(5, 3)` — mit
  Klammern UND mehreren Argumenten — ging bisher schief (der Übersetzer las `(5` als angefangene Klammer
  und stolperte über das Komma); jetzt läuft er. (2) Setzt Du nur das ERSTE Argument in Klammern,
  `DrawText (1), 2, "hi"`, wird das nicht mehr für die Klammer um die ganze Liste gehalten — ein
  Ein-Zeichen-Blick voraus erkennt am Komma hinter der `)`, dass es bloß ein gruppiertes erstes Argument
  war. (3) Vergisst Du die Pflicht-Klammern bei einer Wert-Funktion (`y = Dist 3` statt `Dist(3)`), bekommst
  Du jetzt einen klaren Satz statt einer kryptischen Fehlermeldung über die Zahl danach: „‚Dist' ist eine
  Funktion und gibt einen Wert zurück — ruf sie mit Klammern auf, z. B. Dist(…)". Unter der Haube teilen
  sich Befehle, anweisungsartige Funktionen und Wert-Funktionen ab jetzt EINE Argument-Routine, statt vier
  leicht verschiedene — weniger Code, der auseinanderlaufen kann. **Damit ist der ganze Parser-Neubau durch:
  jede der Schreibweisen, an denen sich der alte Parser verschluckte, parst jetzt sauber.**
- **`If` versteht jetzt jede natürliche Schreibweise (EISEN M2.T3).** Bisher gab es eine stille
  Stolperstelle: Schriebst Du `If x > 0 Then` und gingst dann in die nächste Zeile (mit `EndIf` am Ende),
  verschluckte sich der Übersetzer — die alte Regel deutete „`Then`" als „jetzt kommt genau EINE Anweisung,
  und zwar sofort", und ein Zeilenumbruch passte da nicht hinein. Auch `If x > 0 Then : … : EndIf` in einer
  Zeile ging nicht. Jetzt gibt es nur noch EINE If-Routine, und `Then` ist überall bloß ein höfliches
  Füllwort: Was DANACH steht, entscheidet die Form — kommt ein Zeilenumbruch, läuft der Rumpf über die
  nächsten Zeilen bis `EndIf`; bleibst Du in der Zeile, ist es eine `:`-Kette bis `EndIf` oder Zeilenende
  (und das `EndIf` darfst Du Dir bei der einzeiligen Form sparen). Alle vier Schreibweisen, die ein Mensch
  intuitiv hinschreibt, parsen damit gleich gut — die einzeilige `If … Then x = 1`, die `:`-Kette, der
  Block mit und ohne `Then`. (Die Inline-Logik ist als wiederverwendbarer Baustein angelegt — einzeilige
  `While`/`For` könnten später denselben Weg gehen.)
- **2D-Tabellen mit Bildschirmbreite sind nicht mehr heimlich teuer.** `feld[x, y]` rechnet intern
  `zeile · breite + spalte` — und der 6502 kann nicht multiplizieren. Bei der typischen Breite 40
  rief der Compiler bisher seine langsame Software-Multiplikation auf (hunderte Takte pro Zugriff),
  ohne dass man es sah — ausgerechnet bei der allerüblichsten Tabellenbreite. Jetzt zerlegt BreadCraft
  eine feste Breite in billige Bit-Verschiebungen (40 = 32 + 8 → zwei Shifts statt einer Multiplikation;
  am Assembler nachgemessen: kein Multiplizierer-Aufruf mehr). Damit ist ein 2D-Zugriff pro Frame wieder
  günstig, so wie die Dokumentation es immer versprochen hatte. (Eine zur Laufzeit variable Breite bleibt
  ehrlich eine Multiplikation — da gibt es nichts zu verschieben.)
- **Ein wachsendes Spiel kann sich nicht mehr heimlich selbst überschreiben.** Unter der Haube lag eine
  tickende Bombe: Der Zeichensatz Deiner Welt lebt an einer festen Stelle im Speicher ($3000), aber der
  Linker wusste nichts davon — er stapelte Programmcode lückenlos nach oben. Klein war alles gut; sobald ein
  Spiel aber über ~10 KB wuchs, schob sich der Code mitten durch den Zeichensatz-Bereich, und beim Start
  kopierte das Spiel seine Kacheln über den eigenen Code: ein unerklärlicher Absturz, keine Warnung. Jetzt
  rechnet BreadCraft vor jedem Build eine maßgeschneiderte Speicherkarte aus dem, was Dein Projekt wirklich
  benutzt: Wer einen Zeichensatz/Sprites verwendet, bekommt genau diese Bereiche **reserviert** — und würde
  der Code hineinwachsen, sagt der Übersetzer es Dir **ehrlich vor dem Start** („passt nicht mehr"), statt
  Dich in einen Geisterabsturz laufen zu lassen. Wer gar keine Grafik benutzt, bekommt im Gegenzug den
  **vollen** Speicher, ohne künstliche Schranke. (Die Adresse, die ins Programm gebacken wird, und die im
  Linker stammen jetzt aus *einer* Rechnung — sie können nicht mehr auseinanderlaufen.)
- **Neue Dateien starten nicht mehr mit einer kaputten Zeile.** Legtest Du eine neue `.crumb`-Datei
  an, schrieb BreadCraft ihr eine Kopfzeile mit dem Dateinamen voran — aber im alten BASIC-Stil mit
  einem Hochkomma (`'`) als Kommentarzeichen. CRUMB kommentiert jedoch mit Strichpunkt (`;`), also war
  ausgerechnet die allererste Zeile jeder frischen Datei für den Übersetzer ein Fehler. Jetzt steht dort
  ein sauberes `;` — die Datei ist vom ersten Zeichen an gültig.
- **Rückwärts zählen läuft jetzt rückwärts — und endet auch.** `For i = 10 To 1 Step -1` tat bisher
  schlicht nichts: der Übersetzer prüfte stur „ist `i` schon zu groß?", und weil 10 sofort größer als 1
  ist, sprang die Schleife übersprungen weiter — kein Durchlauf, kommentarlos. Jetzt erkennt BreadCraft den
  negativen Schritt und zählt richtig herunter. Und es gibt eine ehrliche Wahrheit obendrauf, die der C64
  Dir sonst böse heimzahlt: eine normale Zahl (`.b`/`.w`) kennt kein „unter Null" — bei 0 springt sie auf
  255 zurück, und eine Abwärtsschleife würde ewig kreiseln. Darum sagt BreadCraft beim Herunterzählen klar:
  „nimm einen `.i`-Zähler" (die vorzeichenbehaftete Zahl, die auch unter Null darf), statt Dich in eine
  unsichtbare Endlosschleife laufen zu lassen.
- **Die 255-Falle beim Hochzählen ist zugemauert.** Spiegelbildlich dazu: `For i = 0 To 255` mit einem
  Byte-Zähler sah harmlos aus, war aber dieselbe Endlosfalle — nach 255 kippt das Byte zurück auf 0, „kleiner
  gleich 255" bleibt für immer wahr. Statt das stillschweigend zu generieren, sagt BreadCraft jetzt ehrlich,
  dass der Zähler überläuft, und schickt Dich zum größeren `.w`-Zähler. (Und ein versehentliches `Step 0`,
  das den Zähler nie bewegt, fällt jetzt ebenfalls sofort auf, statt das Programm festzunageln.)
- **Rechnungen mit `Shl`, `Xor` & Co. ergeben jetzt, was Du meinst.** Eine stille, gemeine Falle:
  CRUMB und die C-Sprache darunter sind sich nicht ganz einig, wie streng manche Rechenzeichen binden.
  In CRUMB klebt `Shl` (und `Shr`/`Xor`) so fest wie ein Mal-Zeichen — `a + b Shl 2` heißt „erst `b`
  verschieben, dann `a` dazu". C sah dieselbe Zeile ohne Klammern und las sie andersherum, rechnete also
  klammheimlich etwas anderes aus. Kein Fehler, keine Warnung — nur ein falsches Ergebnis, das erst im
  Spiel auffällt. Jetzt setzt der Übersetzer um jede Teilrechnung eine Klammer, genau so, wie Du sie
  gedacht hast; das Ergebnis stimmt immer mit Deiner Zeile überein. (Sichtbar wird das nur, wenn Du in die
  optionale C-Ansicht schaust — die zeigt jetzt mehr Klammern. Ein Schaufenster lügt nicht, also zeigt es
  ehrlich, was passiert; ein aufgeräumterer Druck, der nur dort klammert, wo's nötig ist, kommt später.)
- **Sprite öffnen rutschte nicht mehr in Frame 1.** Wer im Explorer doppelt auf ein Sprite klickte, sah
  seine Figur plötzlich in Frame 1 wandern, mit einem leeren Frame 0 davor. Schuld war ein winziges
  Zeitfenster: Der Editor leerte die Bildliste, *bevor* er die Datei gelesen hatte — und in genau diesem
  Augenblick schob die Leinwand reflexartig ein leeres Bild nach. Jetzt wird erst gelesen, dann in einem
  Zug getauscht; ein leerer Zwischenzustand entsteht gar nicht erst.

### Hinzugefügt
- **Das `.sprite`-Format: ein Zuhause für bewegte Gestalten.** BreadCraft kennt jetzt das Dateiformat
  für Sprites — die freischwebenden 24×21-Figuren, die der C64 unabhängig vom Kachel-Hintergrund über
  den Bildschirm schiebt (Spieler, Gegner). Eine `.sprite`-Datei = *eine* Figur, aber von Anfang an mit
  Platz für mehrere Animations-Bilder derselben Figur, damit später das Laufen wackeln und der Schleim
  schwabbeln kann, ohne dass das Format neu erfunden werden muss. Wie schon beim Charset speichert die
  Datei die rohen C64-Bytes (63 pro Bild, modus-unabhängig) — Hi-Res oder Multicolor wird beim Malen
  interpretiert, nicht in die Datei eingebrannt; alle vier Multicolor-Farben überleben das
  Speichern+Laden verlustfrei. Das Projekt-Manifest führt jetzt eine `sprites`-Liste, und die Bauwerk-
  Brücke kann eine Sprite-Gestalt aus ihrem Namen auflösen (streng und früh: ein unbekannter Name, eine
  fehlende Datei oder ein verbogenes Bild fällt sofort auf, lange bevor der Compiler läuft).
- **Der Sprite-Editor: Figuren malen, Bild für Bild.** Jetzt lässt sich eine Sprite-Gestalt direkt im
  IDE malen — auf demselben Pixel-Werkzeugkasten wie der Zeichensatz-Editor (Stift, Linie, Rechteck,
  Füllen, beliebig zurück und vor), nur auf der Sprite-Leinwand von 24×21 Pixeln. Im Multicolor-Modus
  zeigt sie ehrlich die doppelt breiten Pixel (2:1), wie der C64 sie zeigt. Links ein **Frame-Streifen**:
  eine Figur kann mehrere Bilder tragen — neue mit „+" anlegen, durchklicken, überzählige wegwerfen
  (das letzte bleibt, eine Figur braucht mindestens eins) —, der Stoff, aus dem später Animation wird.
  Die Farben kommen aus der Projekt-Palette, gespeichert wird wie überall bewusst von Hand (Knopf oder
  Strg+S), und die Figur überlebt den Neustart.
- **`UseSprite`: die gemalte Figur landet im Programm.** Der Befehl, der ein im Sprite-Editor gemaltes
  Bild zur Übersetzungszeit in das C64-Programm einbäckt und einem der acht Hardware-Sprite-Slots gibt:
  `UseSprite 0, "player"`. Der Slot (0–7) ist dieselbe Nummer, die `Sprite`, `ShowSprite` und
  `HideSprite` verwenden — `UseSprite` gibt die *Gestalt*, jene geben *Position* und *Sichtbarkeit*. Am
  lesbarsten vergibt man ihn als benannte Zahl (`Const SPIELER = 0`), statt nackte Ziffern durchs
  Programm zu tragen. BreadCraft bäckt nur, was nötig ist, prüft einen festen Slot vorab gegen die
  C64-Wahrheit (es gibt genau acht; eine 8 ist ein ehrlicher Fehler, kein kryptischer cc65-Absturz), und
  im Multicolor-Modus setzt es das Sprite-Multicolor-Bit und die geteilten Farben aus der Projekt-Palette
  gleich mit. Auf echter cc65 zur lauffähigen `.prg` gebaut und in VICE bewegt. *(Die individuelle, dritte
  Sprite-Farbe ist vorerst ein Standardwert — eine pro-Sprite wählbare Farbe kommt später.)*
- **Vorzeichen-Zahlen: der neue Typ `.i`.** Bisher kannte BreadCraft nur Zahlen ab null aufwärts
  (`.b` 0–255, `.w` 0–65535). Für Bewegung braucht man aber auch *negative* Werte — eine Sprung-
  Geschwindigkeit zeigt nach oben, ein Abstand kann in beide Richtungen gehen. Dafür gibt es jetzt
  `.i`: eine vorzeichenbehaftete Ganzzahl von −32768 bis 32767. Damit liest sich Physik so, wie man
  sie denkt — `vy.i = 0 - sprungkraft` lässt die Figur steigen, die Schwerkraft zählt sie wieder
  herunter. „Vorzeichen ist ansteckend": rechnet man mit einer `.i`-Zahl, bleibt das Ergebnis
  vorzeichenbehaftet, und BreadCraft warnt ehrlich, falls ein negativer Wert in einen Typ ohne
  Vorzeichen geschrieben würde (wo er sich in eine riesige Zahl verwandeln würde). Auf echter cc65 gebaut.
- **Rechen-Helfer: `Abs`, `Min`, `Max`.** Die drei kleinen Werkzeuge, die fast jede Spiellogik
  braucht: **Abs** für den Betrag (etwa der Abstand zweier Dinge — `Abs(spielerX - gegnerX)`, egal wer
  links steht), **Min** und **Max** zum Begrenzen (Leben auffüllen, aber nie über das Maximum:
  `leben = Min(leben + trank, 20)`; und nie unter null: `leben = Max(leben - schaden, 0)`). Alles reine
  Ganzzahl-Mathematik (der C64 kennt keine Kommazahlen, und das soll er auch nicht müssen), billig, im
  Frame nutzbar. Auf echter cc65 gebaut.
- **Funktionen: eigene Bausteine, statt ein 300-Zeilen-Block.** BreadCraft versteht jetzt
  `Function … Return … EndFunction` — der Weg, Spiellogik in lesbare Stücke zu zerlegen (Sprungphysik,
  Kollision, Gegner-Update). Das Suffix am Namen entscheidet alles: **mit** `.b`/`.w`/`$` gibt die
  Funktion einen Wert zurück und wird mit Klammern aufgerufen (`weite.w = Distance(a, b)`); **ohne**
  Suffix ist sie ein Befehl ohne Rückgabewert, aufrufbar ohne Klammern (`Heil 10`). Parameter und
  eigene Variablen leben nur im Aufruf; geteilten Zustand hält man über `Global`. **Rekursion** (eine
  Funktion ruft sich selbst) ist ehrlich verboten — der 6502 hat keinen echten Variablen-Stack, also
  sagt BreadCraft das klar, statt es heimlich überlaufen zu lassen.
- **Records an Funktionen übergeben, ohne Kopier-Kosten.** Man darf einer Funktion einen ganzen
  `Type` (z. B. einen Gegner) übergeben — `Function Treffer.b(g.Gegner)` — und im Code fühlt es sich
  an wie „Wert rein". Hinter den Kulissen reicht BreadCraft nur die Adresse weiter (kein Byte-für-Byte-
  Kopieren auf dem 6502) und sorgt dafür, dass die Funktion den übergebenen Record nur lesen, nicht
  heimlich verändern kann. Auf echter cc65 gebaut und geprüft — der Komfort kostet nichts.
- **Eingabe: der Joystick steuert das Spiel.** Der Übersetzer versteht jetzt **Joystick(RICHTUNG)** —
  eine ehrliche Ja/Nein-Frage „wird gerade nach LEFT, RIGHT, UP, DOWN oder gegen FIRE gedrückt?"
  (Port 2, der C64-Spiele-Standard). Keine Achsenwerte, weil der C64 keine kennt — fünf Bit, mehr
  gibt die Hardware nicht her. Der Treiber wird einmal beim Programmstart hinter den Kulissen
  eingerichtet; im Spiel fragt man einfach `If Joystick(LEFT) Then …`. Damit baut der erste
  **per Joystick bewegte Sprite** end-to-end bis zur lauffähigen `.prg` (mit der gebündelten cc65
  geprüft). Noch nicht dabei: **KeyDown/KeyHit** (Tastatur) — die C64-Tastaturmatrix und die
  Tasten-Konstanten bekommen einen eigenen Milestone; bis dahin bewegt der Joystick.
- **Sprites: bewegliche Figuren, die der VIC-Chip von selbst zeichnet.** Der Übersetzer
  versteht jetzt die vier Sprite-Befehle: **Sprite n, x, y** stellt Sprite Nummer n an eine
  Pixelposition (0–319 / 0–255) — anders als eine Kachel klebt es nicht am 8×8-Raster, sondern
  gleitet pixelweise; das fummelige 9. X-Bit (für die rechte Bildschirmhälfte) erledigt BreadCraft
  hinter den Kulissen. **ShowSprite n** / **HideSprite n** schalten ein Sprite an und aus,
  **Sprite n, OFF** ist die Kurzform fürs Ausschalten. Alle bauen end-to-end bis zur lauffähigen
  `.prg` (mit der gebündelten cc65 geprüft). Noch nicht dabei: **UseSprite** (die gemalte
  Sprite-Form einbacken) — dafür fehlt noch der Sprite-Editor, das kommt mit dessen Milestone;
  bis dahin positioniert/zeigt/versteckt man Formen, die anderswo eingerichtet wurden.
- **Vorschau in den Editoren: man sieht, wohin man malt.** Fährt man im Tilemap-Editor mit
  der Maus über die Karte, erscheint die ausgewählte Kachel schon halbtransparent auf der Zelle
  unter dem Zeiger — in der gerade gewählten Zellfarbe. Im PETSCII-Editor leuchtet das Pixel unter
  dem Zeiger in der aktiven Stiftfarbe auf. So weiß man vor dem Klick genau, was wohin kommt; die
  Vorschau verändert das gemalte Bild nicht.
- **Die Tile-Welt lebt: Kacheln setzen, lesen, auf sie treten.** Der Übersetzer versteht jetzt
  die vier Kachel-Befehle für bewegtes Spielgeschehen: **SetTile** (eine Zelle auf eine Kachel +
  Farbe setzen — z. B. ein Gegner, der über die Karte wandert), **GetTile** (nachschauen, welche
  Kachel an einer Zelle liegt — auch in einer unsichtbaren Datenebene „darunter", für das
  Latent-Object-Muster), **TileAt** (welche Kachel liegt an einer Pixelposition — für Sprites) und
  **TileSolid** (ist die Kachel an dieser Pixelposition fest? — die Basis für „läuft nicht durch
  Wände"). Alle vier bauen end-to-end bis zur lauffähigen `.prg` (mit der gebündelten cc65 geprüft).
  Noch nicht dabei: die unsichtbare Datenebene wird vorerst als leer angenommen, und „fest" gilt per
  Voreinstellung für jede Kachel außer der leeren — beides bekommt später eigene Editor-Knöpfe.
  Die zusammengesetzten MetaTiles (SetMetaTile) folgen mit dem MetaTiles-Editor.
- **Freie Zellfarbe (Color-RAM) im Tilemap-Editor.** Jede Karten-Zelle bekommt im
  Multicolor-Modus ihre eigene vierte Farbe — genau wie auf dem echten C64, wo diese Farbe
  pro 8×8-Zelle frei im Color-RAM steht. Ein neuer 16-Farben-Picker (nur im Multicolor-Modus
  sichtbar) wählt die Farbe, mit der der Stift malt; die Karte und die Kachel-Vorschau zeigen
  sie sofort. Die `.tilemap`-Datei speichert diese Zellfarben mit; ältere Karten ohne sie laden
  unverändert (jede Zelle startet dann auf Hellgrau). Vorher zeigte die vierte Farbe überall eine
  feste Vorschaufarbe.
- **Malen im Multicolor-Modus (Doppelpixel-Canvas).** Der PETSCII-Editor zeichnet im
  Multicolor-Modus jetzt auf einem 4×8-Raster mit doppelt breiten Pixeln (Seitenverhältnis
  2:1) — genau so, wie der C64 seine Multicolor-Pixel zeigt (WYSIWYG). In Hi-Res bleibt es das
  scharfe 8×8-Raster. Der gemeinsame Zeichensatz-Renderer (Navigator-Vorschau, Tilemap-Karte,
  Kachel-Palette) versteht beide Modi, sodass ein gemaltes Zeichen überall gleich aussieht.
  Damit ist das Malen im Multicolor-Modus wieder möglich (die Daten-Reparatur davor hatte das
  Pixelraster auf 4×8 umgestellt).
- **Neues-Projekt-Dialog mit Grafikmodus-Wahl.** „Neues Projekt" fragt jetzt nicht mehr
  nur stumpf nach einem Namen, sondern öffnet einen richtigen Dialog: Name, Grafikmodus und
  ein Häkchen „Startgerüst anlegen" (per Default an). Alle drei Phase-1-Modi sind sichtbar,
  damit man weiß, wohin die Reise geht — aber nur **Text, Multicolor** ist heute wählbar, die
  beiden anderen tragen ein ehrliches „(kommt später)". Der gewählte Modus landet fest in der
  `.bread`-Datei; ist das Häkchen aus, bekommt `main.crumb` nur die nackte `Graphics …`-Zeile
  statt des kommentierten Frame-Schleifen-Gerüsts. Toolbar und Startseite öffnen denselben Dialog.
- **Projekt-Grafikmodus wird gespeichert.** Ein Projekt hat jetzt einen festen
  Grafikmodus (`TEXT_HIRES`, `TEXT_MULTICOLOR` oder `BITMAP_MULTICOLOR`), der in der
  `.bread`-Projektdatei liegt — die eine Wahrheit, an der sich später Editoren (Pixel-
  Seitenverhältnis, Palette) und der Transpiler (`Graphics …`) ausrichten. Bestehende
  Projekte ohne dieses Feld werden automatisch als `TEXT_MULTICOLOR` gelesen, gehen also
  nicht kaputt. Sicht- und auswählbar wird der Modus erst im Neues-Projekt-Dialog (folgt);
  hier ist zunächst nur das Fundament gelegt. Die `Graphics …`-Zeile der Startvorlage wird
  jetzt aus dem Modus abgeleitet (über die Sprach-SSOT, nicht mehr fest verdrahtet) — sobald
  andere Modi wählbar sind, schreibt ein neues Projekt automatisch den passenden Befehl.
  Der Paletten-Editor richtet sich ebenfalls nach dem Modus: in Hi-Res zeigt er nur den
  Hintergrund (mit einer kurzen Erklärung, warum), in Multicolor alle drei geteilten Farben.
  Im aktuellen Standardmodus (Multicolor) sieht man davon noch nichts — es greift, sobald
  Hi-Res wählbar wird.
- **Multicolor-Charsets werden verlustfrei gespeichert (Daten-Reparatur des MC-Bugs).**
  Im Multicolor-Zeichenmodus speichert das Charset-Format jetzt alle vier Farben pro
  Doppelpixel als eigenes 2-Bit-Paar (neuer Konverter `indicesToBytesMC`/`bytesToIndicesMC`,
  4 Doppelpixel/Zeile, links = höchstwertig). Das Speichern/Laden richtet sich nach dem
  Projekt-Grafikmodus — die rohen Charset-Bytes überleben den Roundtrip damit ohne Verlust.
  Das ist die Wurzel-Reparatur für „mit 4 Farben gemaltes Charset zeigt nach Neustart nur
  noch 2": der alte Pfad konnte nur 1 Bit/Pixel und ließ die Farben 2 und 3 kollabieren.
  **Noch nicht durch:** das eigentliche *Malen* im Multicolor-Modus (4×8-Doppelpixel-Canvas)
  folgt im nächsten Schritt — bis dahin ist hier nur die **Daten-Ebene** repariert, nicht der
  Editor. Die Bit-Packung ist normativ festgeschrieben (`PETSCII_FORMAT.md` §1.1). (+11 Vitest.)
- **„Neue Datei" ohne offenes Projekt legt ein temporäres Projekt an.** Klickt man in der
  Toolbar auf „Neue Datei", während kein Projekt offen ist, passierte bisher nichts. Jetzt
  entsteht sofort ein **temporäres Projekt** unter `<Arbeitsverzeichnis>/temp/` (ein vollwertiges
  Projekt mit `main.crumb`, nur am temp-Ort + mit Ablauf) und der Code-Editor öffnet sich — „neue
  Datei → los", ohne Namens-Dialog. Die Mechanik (`createTempProject`) gab es längst; sie war nur
  nicht ans UI verdrahtet. Das ist das in [[breadcraft-ide-architecture]] festgehaltene
  Temp-Projekt-Konzept, jetzt als konkretes Toolbar-Verhalten umgesetzt.

### Behoben
- **Namen, die wie ein Sprachwort aussehen, brachen den Übersetzer.** Hieß eine Konstante,
  ein Record oder ein Record-Feld wie ein eingebautes Wort — etwa `Const MAX = 5` (`Max` ist
  eine Funktion), `Const LEFT = 1` (`LEFT` eine Richtung) oder ein Feld `len`/`type` — scheiterte
  die Übersetzung mit „Name erwartet" bzw. „Feldname erwartet". Grund: der Übersetzer erkannte das
  Wort als Sprachwort, bevor er merkte, dass es hier ein selbst vergebener Name ist. Jetzt nimmt er
  an einer Namensstelle (nach `Const`/`Type`/`Field` und beim Feldzugriff `…\feld`) den Namen so, wie
  man ihn geschrieben hat. Beide Fälle bauen end-to-end bis zur lauffähigen `.prg` (mit der
  gebündelten cc65 geprüft).
- **Tilemap-Editor war unbenutzbar langsam.** Die 40×25-Karte wurde als DOM-Gitter
  gerendert — **~64.000 `<i>`-Knoten** (1000 Zellen × 64 Mini-Pixel), bei jedem Mal-Klick
  komplett neu aufgebaut. Jetzt zeichnet der Editor die Karte auf ein echtes **`<canvas>`** in
  der nativen C64-Auflösung 320×200 (per CSS skaliert, `image-rendering: pixelated`): keine
  DOM-Last, beim Malen wird **nur die geänderte Zelle** neu gezeichnet (rAF-coalesced), ein
  Voll-Redraw nur bei Charset-/Palette-Wechsel oder Projekt-Laden → flüssig auch beim schnellen
  Ziehen. Neuer gemeinsamer, getesteter Charset-Renderer (`pixel-engine/charsetRender.ts`,
  `drawChar`) zeichnet ein 8×8-Zeichen aus den Index-Daten — von Karte UND Kachel-Palette
  genutzt (DRY, ersetzt die kopierte Hex-Vorschau). Der gestaffelte Plan, **alle** grafischen
  Editoren so umzubauen (PETSCII/Sprite/Bitmap folgen), steht in BREADCRAFT_IDE.md §3.0.1.
  (+5 Vitest; 163 gesamt.)
- **Neue Projekte starteten mit fehlerhaften Kommentaren.** Die `main.crumb`-Startvorlage
  (und das `asm.escape`-Beispiel in der Hover-Doku) leiteten Kommentare mit `'` ein — aber
  das BreadCraft-Kommentarzeichen ist `;` (Sprachdef §B); `'` ist ein Lexer-Fehler. Ein
  frisch angelegtes (auch temporäres) Projekt war damit von Anfang an nicht transpilierbar.
  Korrigiert auf `;`; die Startvorlage nutzt jetzt zudem `Graphics TEXT, MULTICOLOR` (der
  gutmütige Tilemap-Normalfall, [[breadcraft-smooth-default-path]]) statt `BITMAP, MULTICOLOR`.
  Die Vorlage transpiliert jetzt fehlerfrei.
- **„Neues Projekt" / „Neue Datei" taten beim Klick nichts.** Diese Buttons (Startseite,
  Toolbar, Explorer) holten den Namen per `window.prompt(…)` — das ist in **Electron-Fenstern
  hart deaktiviert** und liefert immer `null`, worauf der Handler lautlos abbrach. Man kam gar
  nicht erst in den Editor. Ersetzt durch einen **eigenen In-App-Eingabedialog** (`PromptModal`,
  im BreadCraft-Design wie der Settings-Dialog): Titel + Textfeld + Abbrechen/Anlegen, **Enter**
  bestätigt, **Esc**/Klick-außerhalb bricht ab. Promise-basierte API im `ui`-Store
  (`ask`/`notify`) ersetzt alle 5 `window.prompt`/`window.alert`-Aufrufe; Fehlermeldungen
  (z. B. doppelter Dateiname) erscheinen jetzt im selben Dialog statt im toten `alert`.
  DE+EN lokalisiert. (Kein Test deckte das ab — `window.prompt` ist Browser-API, daher fiel
  der Bug durch alle grünen Suiten; künftig per manuellem End-to-End-Klick geprüft.)

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
- **Transpiler Stufe 2, Teil B: `UseTileset` + `DrawMap` — die gemalte Karte läuft im C64
  (Teil C).** Das Erfolgserlebnis: ein im Editor gemaltes Charset + eine gemalte Karte werden
  zur Compile-Zeit in C eingebacken und zeigen sich als Bild (Referenz `_preflight/tilemap.c`):
  - **Asset-Brücke in den CodeGen eingestöpselt:** `generate`/`compile` nehmen einen optionalen
    Projekt-Asset-Kontext; `build.ts` baut ihn aus `listAssets`/`readAsset`. Ohne Projekt-Kontext
    melden die Befehle einen ehrlichen Fehler statt zu raten.
  - **`UseTileset "main"`** löst das `.petscii` über die Brücke auf, backt die 256×8 Charset-Bytes
    als `static const` ein, kopiert sie nach `$3000`, setzt `VIC.addr = $1C` (der `$D018`-Teil,
    den `Graphics` bewusst ausließ) und die drei MC-Text-Shared-Farben.
  - **`DrawMap "level1"`** löst das `.tilemap` auf (neue `resolveTilemap`, spiegelt
    `resolveCharset`, gleiche strenge Eager-Fehler), backt die 1000 Kachel-Nummern ein und
    kopiert sie ins Screen-RAM (VIC zeichnet die Karte gratis) + Color-RAM mit MC-Bit. Braucht
    ein aktives Tileset — sonst ehrlicher Fehler.
  - **Auf echter cc65 bewiesen:** ein Crumb mit `Graphics TEXT, MULTICOLOR` / `UseTileset` /
    `DrawMap` / Frame-Loop baut mit dem gebündelten `cl65` zu einem gültigen **3590-Byte-`.prg`**
    (gemaltes Charset + gemalte Map eingebacken).
  - **Noch offen in Teil B:** per-Zelle-Farbe (fester Color-RAM-Wert vorerst), MetaTiles,
    `UseSprite`/`UseImage`/`DrawImage`, `SetTile`/`SetMetaTile`.
  (+6 CodeGen- +8 Resolver-Tests; 158 Vitest gesamt.)
- **Tilemap-Editor (minimal, Teil B): Karten malen.** `TilemapView.vue` ist nicht mehr ein
  Platzhalter, sondern ein echter Editor — man malt die **40×25-Karte**, indem man eine
  **Kachel** (ein im PETSCII-Editor gemaltes Zeichen) in Zellen stempelt (Klick + Ziehen).
  Drei schwebende Panels (Kachel-Palette / Karten-Raster / Werkzeug), gespiegeltes Chrome aus
  dem PETSCII-Editor (FloatPanels, Speichern-Button + dirty-Punkt, Layout-Reset, **Strg+S**,
  Watermark). Die Kachel-Vorschau nutzt **dieselbe** Zeichen→Farb-Logik wie der PETSCII-Editor —
  eine Kachel sieht hier exakt aus wie dort. Phase 1 bewusst minimal: nur der sichtbare
  Grafik-Layer + Einzel-Kachel-Stift; META-Layer, MetaTile-Pinsel und Geister-Overlay wachsen
  additiv nach (TILEMAP_EDITOR.md). Zähler „gesetzte Zellen / 1000". DE+EN lokalisiert.
- **Tilemap-Fundament: `.tilemap`-Format + Store (Teil A des Tilemap-Editors).** Der
  Unterbau, damit eine gemalte Karte auf Disk lebt und beim Build aufgelöst werden kann
  (TILEMAP_EDITOR.md):
  - **`.tilemap`-Dateiformat** (`serializeTilemap`/`parseTilemap` in `assetIo.ts`): ein
    40×25-Grafik-Layer aus 1000 Tile-Nummern (0–255). Die Form ist bereits ein **Layer-Array**
    (`layers:[{type:'grafik',tiles:[…]}]`), nicht zwei hartkodierte Felder — so passen spätere
    Layer (META-Daten, Parallax) **ohne Format-Umbau** dazu. Defensiv beim Lesen (kaputt/zu kurz
    → leer statt Müll), per Roundtrip-Tests abgesichert.
  - **Tilemap-Store** (`stores/tilemap.ts`, spiegelt den Charset-Store): dichtes
    `Uint8Array(1000)`, `tileAt`/`setTile`, explizites `save()`/`loadForProject`, dirty-Flag.
    Auf Disk als `main.tilemap`, im `.bread`-Manifest unter `tilemaps[]` (Manifest-/IO-Unterbau
    war schon da — keine Main-Änderung nötig). Beim Projekt-Öffnen automatisch geladen.
  (+8 Vitest; 144 gesamt. Vitest kennt jetzt auch den `@renderer`-Alias für Store-Tests.)
- **Transpiler Stufe 2, Teil B (Fundament): die `.bread`-Asset-Brücke.** Das fehlende
  Bindeglied zwischen dem PETSCII-Editor und dem Transpiler (BREADCRAFT_TRANSPILER_ROADMAP.md
  Stufe 2 Teil B / §2.5). Tile-/Sprite-Befehle benennen ihre Grafik per String
  (`UseTileset "main"`); diese Brücke übersetzt eine solche **Asset-ID → die echten
  C64-Bytes**, die der Editor gemalt hat (das `.petscii` ist bereits C64-Wahrheit:
  256 Slots × 8 rohe Bytes).
  - **Streng & sofort (eager):** Auflösen prüft umgehend — unbekannte ID,
    fehlende/kaputte Datei, falsches Format oder Byte-Layout sind ein **ehrlicher
    Fehler an der Stelle des verursachenden Befehls**, lange bevor cc65 läuft. Kein
    stiller Fallback (kosten-ehrliches Sicherheitsnetz). Unbekannte ID nennt zudem,
    welche Tilesets das Projekt kennt.
  - **Rein & IO-frei:** der Reader (Datei → Text) wird hereingereicht, der Resolver
    fasst kein Dateisystem an und importiert keinen Renderer-Code — ohne Filesystem
    unit-testbar, hält die Repo-Struktur-Trennung. Auflösung über den Dateinamen-Stamm
    (`"main"` ↔ `main.petscii`).
  - **Noch kein sichtbarer Output:** bewusst nur die Brücke — der `UseTileset`/`DrawMap`-
    CodeGen (Bytes wirklich ins C einbacken, `$D018` setzen) ist der nächste Block.
  (+12 Vitest; 136 Tests gesamt.)
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
