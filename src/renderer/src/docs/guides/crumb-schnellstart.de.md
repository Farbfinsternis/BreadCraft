# Schnellstart: In fünf Minuten bewegt sich was

Hi! Kein langes Vorwort — Du bist hier, um etwas *passieren* zu sehen. Am Ende dieser
Seite läuft ein winziger gelber Ball über Deinen C64-Bildschirm, und Du hast ihn
selbst gebaut. Ohne Vorwissen, ohne Grafik zu malen, mit einer Handvoll Zeilen.

Tipp einfach mit. Erklären tue ich nebenbei.

**Wohin tippen?** Ist noch kein Projekt offen, klick oben auf **Neue Datei** — BreadCraft
legt dir im Nu ein kleines Wegwerf-Projekt mit einer `main.crumb` an und setzt Dich mitten
hinein. Genau da kommt der Code von gleich rein: abtippen oder einfach hineinkopieren.

---

## Erst die Bühne

Drei Zeilen richten den Bildschirm ein:

```
SetMode TEXT
BorderColor BLACK
Cls BLUE
```

`SetMode TEXT` sagt: normaler Text-Bildschirm. `BorderColor BLACK` färbt den Rand
ringsherum schwarz. `Cls BLUE` wischt die Fläche in der Mitte sauber und streicht sie
blau. Fertig ist die Bühne — leer und blau, bereit für den Auftritt.

## Jetzt der Auftritt

Ein Spiel läuft nicht einmal durch und ist fertig. Es wiederholt sich, Bild für Bild:
etwas bewegen, kurz warten, wieder von vorn. Genau das schreiben wir jetzt.

```
SetMode TEXT
BorderColor BLACK
Cls BLUE

Color YELLOW          ; womit gemalt wird: gelb
x.b = 0               ; die Position des Balls, ganz links

While 1               ; „für immer" — die Hauptschleife
  DrawText x, 12, " " ; Ball an alter Stelle wegwischen
  x.b = x + 1         ; einen Schritt nach rechts
  If x.b > 39 Then x.b = 0   ; am rechten Rand? dann links wieder rein
  DrawText x, 12, "O" ; Ball an neuer Stelle malen
  VWait               ; ein Bild lang warten — das gibt das ruhige Tempo
Wend
```

Das war's. Drück jetzt **Build & Run**.

---

## Was Du gerade siehst

Ein gelbes `O` wandert gemächlich von links nach rechts, verschwindet am Rand und
kommt links wieder herein. Für immer. Das ist keine Zauberei, das ist Dein Programm:

- `x.b` ist die **Position** des Balls. `.b` heißt nur „eine kleine Zahl von 0 bis
  255" — mehr musst Du dazu jetzt nicht wissen.
- Die **Hauptschleife** `While 1 … Wend` läuft endlos. In jedem Durchlauf wischen wir
  den Ball weg, schieben `x` um eins weiter und malen ihn neu. Fünfzig Mal pro Sekunde.
- `VWait` ist der heimliche Held: Es wartet jeweils auf das nächste Bild. Ohne das
  würde der Ball so schnell rasen, dass Du nur ein Flimmern siehst.

Und da hast Du es — die Grundform *jedes* Spiels: Position ändern, warten, wiederholen.
Alles Weitere sind nur mehr Bälle und schönere Bilder.

---

## Jetzt spiel damit

Am schnellsten bekommst Du ein Gefühl für CRUMB, wenn Du an den Stellschrauben drehst.
Ändere eine Kleinigkeit, drück Build & Run, schau was passiert:

- Tausch `YELLOW` gegen `RED`, `WHITE`, `CYAN` … 16 Farben stehen bereit.
- Mach aus dem `"O"` ein `"*"`, ein `"A"` oder gleich ein ganzes Wort.
- Schreib `x.b = x + 2` — schon flitzt der Ball doppelt so schnell.
- Ändere die `12` (die Zeile), dann läuft er weiter oben oder unten.

Mach es kaputt und wieder heil. Genau so lernt man's.

---

### Wie geht's weiter?

Jedes Wort, das CRUMB kennt — mit Beispiel und ehrlicher Angabe, was es den C64 kostet
— findest Du in der **Referenz** in der Seitenleiste. Stöber ruhig herum. Und wenn Du
anfängst, ein echtes Spiel zu bauen, warten dort Kacheln, Sprites und der Rest der
Werkstatt auf Dich.
