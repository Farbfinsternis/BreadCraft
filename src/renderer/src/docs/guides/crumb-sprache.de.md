# CRUMB, deine erste eigene Sprache

Hi, schön dass Du hier bist! Ich nehme an, Du möchtest gern dem Computer sagen, was
er tun soll, und hast noch keine Ahnung, wie man das macht? Perfekt, genau dafür ist
dieses Heft da. Wir fangen ganz vorne an, und ich verspreche Dir: Du brauchst
keinerlei Vorwissen. Nur ein bisschen Neugier.

CRUMB ist die Sprache, in der Du Deine Programme schreibst. Sie ist mit Absicht klein
und freundlich gehalten und liest sich fast wie eine Beschreibung dessen, was
passieren soll. Keine kryptischen Zeichenfolgen, kein Geheimwissen. Versprochen.

> Kleiner ehrlicher Hinweis vorweg: Hier steht nur, was heute schon funktioniert.
> CRUMB wächst noch fleißig weiter, und mit der Zeit kommt einiges dazu. Aber alles,
> was Du auf diesen Seiten findest, kannst Du sofort ausprobieren.

Bereit? Dann los.

---

## 1. Die allererste Zeile

Ein Programm ist nichts anderes als eine Liste von Anweisungen, also Dinge, die getan
werden sollen. Der Computer arbeitet sie brav von oben nach unten ab, eine nach der
anderen. Wie ein Rezept.

Hier ist schon eine vollständige Anweisung:

```
BorderColor BLUE
```

Das war's, diese eine Zeile färbt den Rahmen rund um den Bildschirm blau. Kein
Drumherum nötig. Bevor wir richtig loslegen, noch drei kleine Spielregeln, dann
kennst Du das Wichtigste.

### Notizen für Dich selbst: Kommentare

Alles hinter einem Strichpunkt `;` ist nur für Dich da. Der Computer überliest es
geflissentlich. Praktisch, um sich selbst Notizen ins Programm zu schreiben. Glaub
mir, in drei Wochen bist Du dankbar dafür.

```
BorderColor BLUE   ; Rahmen blau machen
```

### Groß oder klein? Egal!

Ob Du `BorderColor`, `bordercolor` oder `BORDERCOLOR` schreibst, ist CRUMB völlig
schnuppe, es versteht alles als dasselbe. Damit Dein Programm aber schön lesbar
bleibt, gibt es eine empfohlene Schreibweise:

- Befehlswörter wie `While` oder `BorderColor` in gemischter Schreibung,
- feste Wörter wie `BLUE` oder `MULTICOLOR` in GROSSBUCHSTABEN,
- Deine eigenen Namen, wie Du magst.

Und keine Sorge, Du musst Dir die ganzen Befehlswörter gar nicht auswendig merken.
Fang einfach an zu tippen. Schon zeigt Dir der Editor eine kleine Liste mit
Wörtern, die an dieser Stelle passen könnten. Du suchst Dir das richtige aus, und es
wird für Dich eingefügt. Das ist nicht nur bequem, es ist auch eine prima Art,
nebenbei zu entdecken, was es überhaupt alles gibt.

Und das Schönste kommt noch obendrauf: Die empfohlene Schreibweise musst Du Dir
ebenfalls nicht merken. Tippst Du `bordercolor` und machst weiter, schreibt der
Editor es ganz von allein in die saubere Form `BorderColor` um, noch während Du am
Programm arbeitest. Du darfst also einfach drauflos tippen, wie es Dir gerade leicht
von der Hand geht; um den Rest kümmert sich die Werkstatt von selbst.

### Mehrere Dinge in eine Zeile

Normalerweise schreibst Du einen Befehl auf eine Zeile, und das Zeilenende sagt
BreadCraft: Hier ist der Befehl zu Ende. Du kannst aber auch einen Doppelpunkt `:`
verwenden, um noch eine zweite, dritte oder vierte Anweisung auf dieselbe Zeile zu
schreiben!

```
BorderColor BLUE : Cls BLACK
```

---

## 2. Farben

An vielen Stellen darfst Du eine Farbe aussuchen. Zum Beispiel wenn der Bildschirm
gelöscht wird oder wenn die Rahmenfarbe (`BorderColor`) gesetzt wird. Es gibt 16 Stück
an der Zahl, und jede hat einen tollen Namen, sodass Du Dir keine Zahlen-Codes merken
musst. Du benötigst nicht einmal ein Notizbuch, denn das ist in BreadCraft schon
eingebaut: Fang an, einen Farbnamen zu tippen, zum Beispiel `BL`, und BreadCraft wird
Dir `BLUE` vorschlagen. Und wenn das Universum es will, weiß BreadCraft auch, wo Dein
Handtuch ist!

```
BLACK   WHITE   RED          CYAN
PURPLE  GREEN   BLUE         YELLOW
ORANGE  BROWN   LIGHTRED     GRAY1
GRAY2   LIGHTGREEN  LIGHTBLUE  GRAY3
```

Du schreibst einfach den Namen dorthin, wo eine Farbe verlangt wird, also etwa
`BorderColor RED`, und fertig. 16 sind nicht die ganze Welt, aber damit lässt sich
schon einiges anstellen.

---

## 3. Etwas auf den Bildschirm zaubern

Jetzt wird es sichtbar. Bevor wir loslegen, möchte ich Dir ein Bild mitgeben, das uns
durch das ganze Heft begleiten wird: Stell Dir Dein Programm wie ein kleines
Theaterstück vor.

Ein Theaterstück hat zwei Phasen. Zuerst kommt die **Vorbereitung**: Die Bühne wird
aufgebaut, das Licht eingerichtet, die Kulisse hingestellt. Das Publikum sieht davon
noch nichts, aber ohne diese Phase gäbe es keine Aufführung. Und dann kommt die
eigentliche **Vorstellung**: Die Schauspieler betreten die Bühne und tun, was sie tun
sollen, Abend für Abend aufs Neue.

Genauso ist Dein Programm gebaut. Am Anfang richtest Du alles ein: Du sagst, wie der
Bildschirm aussehen soll, machst ihn sauber, legst Farben fest. Erst danach lässt Du
das eigentliche Geschehen los. Diese Trennung in *erst vorbereiten, dann spielen* ist
keine lästige Pflicht, sondern sie hilft Dir, den Überblick zu behalten. Und sie
erklärt, warum ein paar Befehle am besten an den Anfang gehören, wie Du gleich sehen
wirst.

Behalt das Theaterbild im Hinterkopf, ich komme immer wieder darauf zurück. Fangen
wir mit der Vorbereitung an.

### Den Bildschirm vorbereiten

```
Graphics TEXT
```

Bevor die Vorstellung beginnt, muss erst einmal die Bühne stehen, und genau das
macht `Graphics`. Der Befehl legt fest, in welcher Betriebsart der Bildschirm
arbeitet. Davon gibt es mehrere, und ich wette, Du bist schon ganz neugierig, was es
mit ihnen auf sich hat. Aber lass uns das Schritt für Schritt angehen. Für den
Anfang ist `Graphics TEXT` Dein bester Freund. Das ist der ganz normale
Text-Bildschirm, auf dem sich Buchstaben und Zahlen am wohlsten fühlen.

Schreib diese Zeile am besten weit nach oben in Dein Programm. Dann steht die Bühne,
das Licht ist an, und alles, was danach auf den Bildschirm kommt, weiß auch, wo es
hingehört. Vergisst Du sie, stolpern die nächsten Befehle ein bisschen im Dunkeln
herum. Also: erst die Bühne, dann die Schauspieler.

Ein Gesetz ist das aber nicht. Gemeint sind nur die Befehle, die wirklich etwas auf
dem Bildschirm anstellen. Alles, was bloß im Hintergrund Dinge vorbereitet, darf
ruhig vorher passieren. Du darfst zum Beispiel schon festlegen, wo Deine Spielfigur
später auftauchen soll oder wie schnell sie sich bewegt, lange bevor die Bühne steht.
Das ist wie der Regisseur, der hinter dem Vorhang schon alles durchspricht, während
das Publikum noch im Foyer steht. Wie Du solche Werte festlegst, schauen wir uns
gleich an.

### Aufräumen und einfärben

```
Cls BLACK
```

`Cls` steht für „clear screen", auf gut Deutsch: Bildschirm putzen. Es fegt den
inneren Bildschirm leer und streicht ihn in einem Rutsch in der Farbe, die Du
angibst, hier schwarz. Damit hast Du eine saubere, einfarbige Fläche, auf der
nachher alles Weitere passiert.

Eine wichtige Sache, falls Du das Wort schon von woanders kennst: `Cls` putzt nur die
große Spielfläche in der Mitte. Den schmalen Rahmen ringsherum lässt es in Ruhe, denn
der ist beim C64 ein eigener Bereich, um den Du Dich getrennt kümmerst (gleich mehr
dazu). „Bildschirm löschen" meint hier also die innere Fläche, nicht das allerletzte
Pixel am Rand.

Und weil `Cls` so gründlich alles wegwischt, gehört es ans Aufräumen *vor* der
Vorstellung, nicht mitten hinein. Rufst Du es auf, wenn Deine Schauspieler längst auf
der Bühne stehen, fegst Du sie kurzerhand mit weg. Erst putzen, dann auftreten lassen.

### Den Rahmen färben

```
BorderColor BLUE
```

Jetzt zu dem Rahmen, den ich vorhin angekündigt habe. Schau Dir ein C64-Bild einmal
genau an: Um die eigentliche Spielfläche läuft ein schmaler Rand ringsherum, fast wie
der Passepartout um ein gerahmtes Bild. Dieser Rand ist ein kleiner Eigenbrötler. Er
hört nicht auf `Cls` und nimmt auch nicht die Hintergrundfarbe der Mitte an, sondern
hat seine ganz eigene Farbe, die Du getrennt bestimmst.

Genau dafür ist `BorderColor` da. `BorderColor BLUE` macht den Rand blau, ganz egal,
was in der Mitte gerade los ist. Anfangs wirkt es vielleicht seltsam, dass der Rand
sein eigenes Süppchen kocht, aber Du wirst die kleine Extrafarbe noch zu schätzen
wissen, wenn Du Dein Bild gestalten willst.

### Endlich: Text schreiben

```
DrawText 5, 10, "HALLO"
```

`DrawText` schreibt Text an eine bestimmte Stelle. Die beiden Zahlen sind die
Position: die erste ist die Spalte (von links gezählt), die zweite die Zeile (von
oben). Was in den Anführungszeichen steht, erscheint auf dem Schirm.

Und schon haben wir gemeinsam unser erstes richtiges Programm:

```
Graphics TEXT
BorderColor BLUE
Cls BLACK
DrawText 5, 10, "HALLO WELT"
```

Vier Zeilen, und etwas passiert. Nicht schlecht für den Anfang, oder?

---

## 4. Dinge merken: Variablen

Stell Dir eine Variable als beschrifteten Behälter vor, in dem Du eine Zahl
aufbewahrst. Du legst sie an, indem Du ihr einfach einen Wert in die Hand drückst:

```
punkte.w = 0
leben.b = 3
```

Zwei Dinge fallen sofort auf:

- Den Namen (`punkte`, `leben`) suchst Du Dir selbst aus.
- Hinten klebt ein kleines Kürzel: `.b` oder `.w`. Das verrät, wie groß die Zahl
  werden darf.

### `.b` und `.w`: wie groß soll's denn sein?

- **`.b`** ist für kleine Zahlen von **0 bis 255**.
- **`.w`** ist für größere von **0 bis 65535**.

Warum der Unterschied? Kleine Behälter brauchen weniger Platz. Wenn Du sicher weißt,
dass eine Zahl nie über 255 klettert (etwa die Anzahl Leben), nimm `.b`. Brauchst
Du mehr Spielraum, etwa für einen stolzen Highscore, dann nimm `.w`. Ganz einfach.

> **Zwei Dinge, die Du wissen solltest** (lieber jetzt als überrascht später):
>
> Es gibt nur ganze Zahlen, keine Kommazahlen wie 3,5. Und negativ wird auch nichts;
> wir fangen immer bei 0 an.
>
> Außerdem: Eine `.b`-Zahl zählt nur bis 255. Zählst Du munter weiter, springt sie
> wieder auf 0 — wie ein Tacho, der überschlägt. Bei `.w` passiert dasselbe bei
> 65535. Such Dir die Größe also passend zu Deinem Vorhaben aus, dann gibt's keine
> bösen Überraschungen.

### Rechnen

Mit Variablen und Zahlen darfst Du nach Herzenslust rechnen: plus, minus, mal,
geteilt.

```
punkte.w = punkte + 10
summe.w = a + b * 2
```

Wie damals in der Schule gilt: Punkt vor Strich. `a + b * 2` rechnet also zuerst
`b * 2` und dann `+ a`. Willst Du die Reihenfolge selbst bestimmen, setzt Du Klammern:

```
summe.w = (a + b) * 2
```

> **Kleine Warnung am Rande:** Wenn Du eine große `.w`-Zahl in einen kleinen
> `.b`-Behälter stopfst, passt sie womöglich nicht hinein, und BreadCraft sagt Dir
> freundlich Bescheid. Das hält Dich nicht auf, es ist nur ein Schubser: Vielleicht
> hast Du die falsche Größe erwischt.

### Zahlen mal anders geschrieben

Meistens schreibst Du Zahlen ganz normal (`42`). Es gibt noch zwei andere
Schreibweisen, die Dir irgendwann über den Weg laufen können:

- ein `$` davor macht eine Hexadezimalzahl (`$FF` ist 255),
- ein `%` davor eine Binärzahl (`%1010` ist 10).

Am Anfang brauchst Du die beiden nicht, normale Zahlen tun's vollkommen. Ich
erwähne sie nur, damit Du nicht erschrickst, wenn sie auftauchen.

---

## 5. Feste Werte mit Namen: `Const`

Manchmal hast Du eine Zahl, die sich nie ändert und trotzdem überall im Programm
auftaucht. Gib ihr einen Namen mit `Const`:

```
Const MAXLEBEN = 3
```

Ab jetzt darfst Du überall `MAXLEBEN` schreiben statt `3`. Das liest sich nicht nur
schöner. Wenn Du den Wert später mal ändern willst, änderst Du ihn an genau einer
Stelle statt an zwanzig. Faulheit, die sich auszahlt.

```
Const MAXLEBEN = 3
leben.b = MAXLEBEN
```

---

## 6. Variablen, die überall gelten: `Global`

Eine Variable, die Du mit `Global` anlegst, gilt im ganzen Programm. Dabei musst Du
ihr gleich einen Startwert mitgeben:

```
Global punkte.w = 0
```

Für Deine ersten Gehversuche reicht es meist, Variablen einfach durch Zuweisung
anzulegen (so wie in Abschnitt 4). `Global` holst Du hervor, wenn eine Variable
wirklich überall verfügbar sein soll.

---

## 7. Ganze Listen von Werten: `Dim`

Oft willst Du nicht eine einzelne Zahl, sondern gleich einen ganzen Schwung
gleichartiger, zum Beispiel für ein Spielfeld. Dafür gibt es `Dim` (das kommt von
„dimensionieren", aber das musst Du Dir nicht merken). Du legst eine Liste mit fester
Länge an:

```
Dim punkte.b[10]
```

Das gibt Dir 10 Behälter, ordentlich durchnummeriert. **Gezählt wird ab 0**, die
zehn Fächer heißen also `punkte[0]` bis `punkte[9]`. Ja, ich weiß, ab 0 ist
gewöhnungsbedürftig. Man gewöhnt sich dran, ehrlich. Ein einzelnes Fach sprichst Du
über seine Nummer an:

```
punkte[0] = 100
punkte[1] = punkte[0] + 50
```

Das `.b` oder `.w` legt auch hier fest, wie groß die Zahlen in der Liste werden
dürfen.

### Ein Gitter: zwei Dimensionen

Für ein Spielfeld mit Spalten und Zeilen gibst Du einfach zwei Größen an:

```
Dim feld.b[40, 25]
```

Das ist ein Gitter mit 40 Spalten und 25 Zeilen. Ein einzelnes Feld erreichst Du mit
zwei Nummern, erst die Spalte, dann die Zeile:

```
feld[5, 3] = 1
```

Mehr als zwei Größen gehen nicht, ein Gitter aus Spalten und Zeilen ist Schluss.
Das klingt vielleicht nach einer Einschränkung, ist für ein Spielfeld aber genau das,
was Du brauchst.

---

## 8. Was zusammengehört, zusammenhalten: `Type`

Manchmal gehören mehrere Werte einfach zusammen. Denk an einen Platz in Deinem
Rucksack: Der hat einen Gegenstand *und* eine Anzahl. Mit `Type` baust Du Dir für
solche zusammengehörigen Angaben einen eigenen kleinen Bauplan:

```
Type Platz
  Field gegenstand.b
  Field anzahl.b
EndType
```

Das ist erst mal nur der Bauplan, sozusagen die Vorlage. Damit Du ihn benutzen
kannst, legst Du Dir davon eine Liste an, meistens mit `Dim`:

```
Dim rucksack.Platz[20]
```

Jetzt hast Du 20 Plätze. An die einzelnen Angaben eines Platzes kommst Du mit einem
Schrägstrich `\`:

```
rucksack[3]\gegenstand = 1
rucksack[3]\anzahl = 5
```

So bleibt fein säuberlich beisammen, was zusammengehört — kein Zettelchaos.

---

## 9. Entscheidungen treffen: `If`

Mit `If` (englisch für „wenn") lässt Du etwas nur dann passieren, wenn eine Bedingung
erfüllt ist.

```
If leben.b = 0
  DrawText 10, 10, "GAME OVER"
EndIf
```

Lies es einfach laut vor: *Wenn `leben` gleich 0 ist, dann schreibe „GAME OVER".*
Das `EndIf` schließt den Block ab. Alles dazwischen gehört zur Bedingung.

### Sonst eben etwas anderes

```
If leben.b = 0
  DrawText 10, 10, "GAME OVER"
Else
  DrawText 10, 10, "WEITER SO"
EndIf
```

`Else` heißt „sonst" und ist der Fall, wenn die Bedingung *nicht* zutrifft.

### Mehrere Fälle hintereinander

```
If punkte.w = 0
  DrawText 1, 1, "NEU"
ElseIf punkte.w = 100
  DrawText 1, 1, "GESCHAFFT"
Else
  DrawText 1, 1, "LAEUFT"
EndIf
```

`ElseIf` prüft noch eine weitere Bedingung, falls die erste nicht gepasst hat.

### Die schnelle Kurzform

Wenn nur eine einzige Anweisung folgt, geht's kürzer mit `Then`, ganz ohne `EndIf`:

```
If leben.b = 0 Then DrawText 10, 10, "GAME OVER"
```

### Was Du vergleichen kannst

In der Bedingung vergleichst Du Werte miteinander:

```
=    gleich
<>   ungleich
<    kleiner
>    größer
<=   kleiner oder gleich
>=   größer oder gleich
```

Und Du darfst Bedingungen sogar verknüpfen:

- `And`: beide müssen zutreffen,
- `Or`: wenigstens eine,
- `Not`: dreht eine Bedingung ins Gegenteil.

```
If punkte.w >= 100 And leben.b > 0
  DrawText 1, 1, "GEWONNEN"
EndIf
```

---

## 10. Etwas wiederholen: Schleifen

Kein Mensch tippt dieselbe Zeile hundertmal ab. Dafür gibt es Schleifen, sie
wiederholen einen Block für Dich.

### Eine feste Anzahl: `For`

`For` zählt eine Variable von einem Wert zum nächsten und wiederholt dabei den Block:

```
For i.b = 1 To 5
  DrawText 1, i, "ZEILE"
Next
```

Wieder einfach vorlesen: *Lass `i` von 1 bis 5 laufen und schreibe jedes Mal
„ZEILE".* `Next` markiert das Ende des wiederholten Blocks. Bei jedem Durchgang wird
`i` um 1 größer.

Willst Du in größeren Sprüngen zählen, gibst Du mit `Step` die Schrittweite an:

```
For i.b = 0 To 10 Step 2
  DrawText 1, i, "X"
Next
```

Hier nimmt `i` der Reihe nach die Werte 0, 2, 4, 6, 8, 10 an.

### Solange etwas gilt: `While`

```
While punkte.w < 100
  punkte.w = punkte + 10
Wend
```

Der Block zwischen `While` und `Wend` wiederholt sich, *solange* die Bedingung
zutrifft. Pass nur auf, dass sich in der Schleife auch etwas ändert, das sie
irgendwann beendet, sonst dreht sie sich ewig im Kreis.

### Bis etwas eintritt: `Repeat`

```
Repeat
  punkte.w = punkte + 10
Until punkte.w >= 100
```

`Repeat` wiederholt den Block, *bis* die Bedingung am Ende (`Until`) erfüllt ist.
Der feine Unterschied zu `While`: Der Block läuft mindestens einmal, weil die Prüfung
erst am Schluss kommt.

### Vorzeitig raus: `Exit`

`Exit` bricht die laufende Schleife sofort ab — wie eine Notausgangstür.

```
For i.b = 1 To 10
  If i.b = 5 Then Exit
  DrawText 1, i, "X"
Next
```

---

## 11. Die Hauptschleife und `VWait`

Jetzt kommt etwas, das fast jedes Spiel braucht. Ein Spiel läuft ja nicht einmal
durch und ist dann fertig. Es wiederholt sich ständig: Bild aufbauen, kurz warten,
wieder von vorn. Diese endlose Wiederholung schreibst Du als Schleife, deren
Bedingung immer zutrifft:

```
While 1
  ; hier passiert in jedem Durchlauf etwas
  VWait
Wend
```

`While 1` bedeutet schlicht „immer wahr", die Schleife läuft also weiter und weiter
und weiter.

Das `VWait` darin ist wichtiger, als es aussieht. Es wartet einen winzigen Moment,
bis das Bild aufgefrischt wird, und sorgt damit für ein ruhiges, gleichmäßiges Tempo.
Ohne `VWait` würde die Schleife so schnell rasen, wie sie nur kann, und alles würde
viel zu hektisch flitzen. Falls Du das `VWait` in so einer Dauerschleife mal vergisst,
stupst BreadCraft Dich freundlich an und erinnert Dich daran. Kein Drama.

---

## Zum Abschluss: alles auf einmal

Hier steckt alles Wichtige aus diesem Heft in einem einzigen kleinen Programm:

```
Graphics TEXT
BorderColor BLUE
Cls BLACK

Const MAXZEILEN = 5

For i.b = 1 To MAXZEILEN
  DrawText 5, i, "HALLO"
Next

While 1
  VWait
Wend
```

Es macht den Bildschirm bereit, schreibt fünfmal „HALLO" untereinander und läuft dann
in aller Ruhe weiter.

Und jetzt kommt das Beste: Tipp es ab und spiel damit herum! Ändere die Farben, dreh
an den Zahlen, schreib einen anderen Text. Mach es kaputt und wieder heil. Genau so,
durch Ausprobieren, bekommst Du am schnellsten ein Gefühl für CRUMB. Viel Spaß
dabei, und bis bald!

---

### Lust auf mehr?

Wenn Du irgendwann anfängst, ein echtes kleines Spiel zu bauen — mit Gegnern, die durch
die Gegend wuseln — kommt früher oder später die Frage auf: *„Wo bewahre ich eigentlich
all meine Gegner auf?"* CRUMB beantwortet die anders, als Du es vielleicht erwartest, und
auf eine ziemlich elegante Weise. Die Geschichte dazu steht im Begleitkapitel
**„Das latente Objekt"** — lies es, wenn es so weit ist.
