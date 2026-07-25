/**
 * Localizable compiler diagnostics (STAHL S5b). The transpiler runs in the main
 * process and used to hard-code German error strings, while the IDE itself speaks
 * de/en — so an English user hit German compiler errors (Befund 5b). This module is
 * the seam: each diagnostic is a function on a locale-bound catalog, so a call site
 * reads `this.M.roleExpected('funcName')` instead of an inline German literal.
 *
 * `compile()` threads the user's locale (from settings) down to the parser/codegen,
 * which build their catalog once via `messages(locale)`. German is the DEFAULT and
 * its text is kept byte-identical to the old literals, so existing tests (which run
 * at the default locale and assert German substrings) stay green; English is purely
 * additive.
 *
 * Scope: the LEXER, PARSER, CODEGEN and asset-RESOLVER stages all localize through
 * this catalog (STAHL S5b complete). The shared format codecs (`@shared/asset-formats`)
 * localize their own structural predicates via their own small message table, which the
 * resolver drives with the same locale.
 */
import type { Locale } from '@shared/ipc'

export type { Locale }
export const DEFAULT_LOCALE: Locale = 'de'

/** A declaration-position name role, so the noun ("Funktionsname"/"function name")
 *  is localized inside the message rather than passed in as a fixed-language word. */
export type RoleKey =
  | 'name'
  | 'typeName'
  | 'fieldName'
  | 'funcName'
  | 'paramName'
  | 'assignTarget'
  | 'loopVar'
  | 'varName'
  | 'arrayName'

export interface ParserMessages {
  /** A reserved CRUMB word used where a user name belongs (`Next = 1`). */
  reservedAsRole(word: string, role: RoleKey, lower: string): string
  /** A declaration name is missing (`Function` with no name). */
  roleExpected(role: RoleKey): string
  /** A statement begins with a keyword not implemented yet (`Select …`). */
  statementNotSupported(what: string): string
  /** A miscased CRUMB keyword (`if` → `If`); case-sensitivity hint. */
  didYouMean(word: string, canon: string): string
  /** A specific literal token is expected (keyword like `EndIf`, or `)` etc.). */
  tokenExpected(name: string): string
  forEqualsExpected(): string
  closeParenExpected(): string
  assignEqualsExpected(): string
  globalEqualsExpected(): string
  constEqualsExpected(): string
  dimBracketExpected(): string
  dimNeedsDimension(): string
  dimTooManyDims(): string
  fieldOrEndTypeExpected(): string
  nestedFunction(): string
  funcParenExpected(): string
  paramListCloseExpected(): string
  returnOutsideFunction(): string
  closeBracketExpected(): string
  expressionExpected(found: string): string
  funcCallParenExpected(name: string): string
  fieldNameAfterBackslash(): string
  /** An `Include` reached the parser unresolved — only the project build pulls files in. */
  includeNeedsProjectBuild(): string
}

export interface CodegenMessages {
  funcRedefined(name: string): string
  paramUnknownRecord(fn: string, rec: string, param: string): string
  unknownFunction(callee: string): string
  recursion(name: string): string
  narrowing(where: string, reason: string): string
  narrowByteReason(): string
  narrowWordReason(): string
  narrowSintReason(): string
  drawTextArgs(): string
  colorArg(): string
  strArgs(): string
  stringFnArg(name: string): string
  stringFnDeferred(name: string): string
  commandNoMapping(name: string): string
  graphicsFirstArg(): string
  graphicsSecondArg(): string
  graphicsBitmapHires(): string
  useTilesetName(): string
  useTilesetNoProject(id: string): string
  useImageName(): string
  useImageNoProject(id: string): string
  useImageTwice(active: string, other: string): string
  drawImageName(): string
  drawImageNoImage(id: string): string
  drawImageOther(baked: string, id: string): string
  drawMapName(): string
  drawMapNoProject(id: string): string
  drawMapNoTileset(id: string): string
  drawMapTooWide(id: string, width: number, screenW: number): string
  playFieldArgs(): string
  playFieldRange(rows: number): string
  playFieldAfterMap(): string
  useMapName(): string
  useMapNoProject(id: string): string
  useMapNoTileset(id: string): string
  useMapNoPlayField(id: string): string
  useMapTwice(active: string, other: string): string
  setCameraXArgs(): string
  cameraNoWorld(word: string): string
  animateTileArgs(): string
  animateTileNoTileset(): string
  animateTileTooMany(max: number): string
  setTileArgs(): string
  spriteArgs(): string
  spriteNumberRange(name: string): string
  useSpriteArgs(): string
  useSpriteSecondArg(): string
  useSpriteNoProject(id: string): string
  useSpriteSlotRange(slot: number): string
  spriteIslandFull(id: string, used: number, need: number, free: number): string
  spriteFrameTooHigh(slot: number, frame: number, count: number): string
  unknownArray(name: string): string
  arrayIndexCount(name: string): string
  recordNoField(cName: string, field: string): string
  frameLoopNoVWait(): string
  forStep0(): string
  forDownNeedsSint(stepVal: number, declName: string): string
  forCounterOverflow(max: number, typeLabel: string, byteDeclName?: string): string
  valueFuncNeedsParens(name: string): string
  getTileArgs(): string
  tileAtArgs(): string
  tileSolidArgs(): string
  absArgs(): string
  minMaxArgs(isMin: boolean): string
  joystickDirArg(): string
  joystickBadDir(name: string): string
  keyboardDeferred(callee: string): string
  recordReturnInExpr(callee: string, returnRecord: string): string
  funcNoMapping(callee: string): string
  getTileLayerConst(): string
}

export interface LexerMessages {
  unexpectedChar(ch: string): string
  invalidDollar(): string
  invalidBinary(): string
  unterminatedString(): string
}

export interface ResolverMessages {
  /** Asset-kind nouns, prefixed onto a structural format error (`<label> '<rel>' …`). */
  labelTileset: string
  labelMap: string
  labelSprite: string
  labelPalette: string
  labelImage: string
  /** The "project knows: (none)" filler when no asset of a kind exists. */
  noneKnown: string
  unknownTileset(id: string, hint: string): string
  tilesetFileMissing(rel: string): string
  charByteCountWrong(rel: string, index: number, bytes: number): string
  charByteBad(rel: string, index: number, byteIndex: number): string
  unknownMap(id: string, hint: string): string
  mapFileMissing(rel: string): string
  tileNumberBad(rel: string, cell: number): string
  colorRamBad(rel: string, cell: number): string
  unknownSprite(id: string, hint: string): string
  spriteFileMissing(rel: string): string
  spriteNoFrames(rel: string): string
  spriteFrameLenWrong(rel: string, frame: number, bytes: number): string
  spriteByteBad(rel: string, frame: number, byteIndex: number): string
  paletteIndexBad(rel: string, field: string): string
  unknownImage(id: string, hint: string): string
  imageFileMissing(rel: string): string
  imageSectionLenWrong(rel: string, section: string, bytes: number): string
  imageByteBad(rel: string, section: string, index: number): string
  imageBackgroundBad(rel: string): string
}

export interface IncludeMessages {
  /** `Include` with no quoted file name after it. */
  includeNeedsPath(): string
  /** Junk after the file name (`Include "a" foo`). */
  includeExtraTokens(): string
  /** `Include` sitting inside a function or block, not at the top level. */
  includeNotTopLevel(): string
  /** The path tries to climb out of the project with `..`. */
  includeEscape(raw: string): string
  /** The path is absolute (leading `/` or a drive letter) instead of project-relative. */
  includeAbsolute(raw: string): string
  /** An empty include path (`Include ""`). */
  includeEmpty(): string
  /** The target file could not be read; `from` is the `file:line` that included it. */
  includeMissing(path: string, from: string): string
  /** A cycle: the arrow chain of files that leads back onto itself. */
  includeCycle(chain: string): string
}

export interface Catalog {
  lexer: LexerMessages
  parser: ParserMessages
  codegen: CodegenMessages
  resolver: ResolverMessages
  include: IncludeMessages
}

const ROLE_DE: Record<RoleKey, string> = {
  name: 'Name',
  typeName: 'Typname',
  fieldName: 'Feldname',
  funcName: 'Funktionsname',
  paramName: 'Parametername',
  assignTarget: 'Zuweisungsziel',
  loopVar: 'Schleifenvariable',
  varName: 'Variablenname',
  arrayName: 'Arrayname'
}

const ROLE_EN: Record<RoleKey, string> = {
  name: 'name',
  typeName: 'type name',
  fieldName: 'field name',
  funcName: 'function name',
  paramName: 'parameter name',
  assignTarget: 'assignment target',
  loopVar: 'loop variable',
  varName: 'variable name',
  arrayName: 'array name'
}

// German lexer diagnostics — kept byte-identical to the former inline literals.
const DE_LEXER: LexerMessages = {
  unexpectedChar: (ch) => `Unerwartetes Zeichen '${ch}'`,
  invalidDollar: () => `Ungültiges '$' (Hex-Zahl oder Typ-Suffix erwartet)`,
  invalidBinary: () => `Ungültige Binärzahl nach '%'`,
  unterminatedString: () => `Nicht geschlossener Text (fehlendes ")`
}

// English lexer diagnostics — additive.
const EN_LEXER: LexerMessages = {
  unexpectedChar: (ch) => `unexpected character '${ch}'`,
  invalidDollar: () => `invalid '$' (expected a hex number or type suffix)`,
  invalidBinary: () => `invalid binary number after '%'`,
  unterminatedString: () => `unterminated string (missing ")`
}

// German — kept byte-identical to the former inline literals (default locale).
const DE_PARSER: ParserMessages = {
  reservedAsRole: (word, role, lower) =>
    `'${word}' ist ein CRUMB-Wort und kann kein ${ROLE_DE[role]} sein — schreib es z. B. klein (${lower})`,
  roleExpected: (role) => `${ROLE_DE[role]} erwartet`,
  statementNotSupported: (what) =>
    `Anweisung beginnend mit '${what}' wird in diesem Schritt noch nicht unterstützt`,
  didYouMean: (word, canon) =>
    `'${word}' ist kein CRUMB-Wort — meintest Du '${canon}'? CRUMB unterscheidet Groß- und Kleinschreibung`,
  tokenExpected: (name) => `'${name}' erwartet`,
  forEqualsExpected: () => `'=' erwartet in For-Schleife`,
  closeParenExpected: () => `')' erwartet`,
  assignEqualsExpected: () => `'=' erwartet (nur Zuweisungen werden in diesem Schritt unterstützt)`,
  globalEqualsExpected: () => `'=' erwartet — Global braucht eine Pflicht-Initialisierung`,
  constEqualsExpected: () => `'=' erwartet in Const-Deklaration`,
  dimBracketExpected: () => `'[' erwartet — Dim braucht eine Größenangabe, z. B. Dim feld.b[10]`,
  dimNeedsDimension: () => `Dim braucht mindestens eine Dimension, z. B. Dim feld.b[10]`,
  dimTooManyDims: () =>
    'Der C64 unterstützt nur 1- und 2-dimensionale Arrays. Mehr Dimensionen brauchen ' +
    'pro Zugriff mehrere Multiplikationen (der 6502 hat keine Hardware-Multiplikation) ' +
    'und kosten schnell sehr viel RAM. Lege stattdessen ein 2D-Array an und rechne die ' +
    'dritte Dimension selbst in den Index (so bleibt die Kostenrechnung sichtbar).',
  fieldOrEndTypeExpected: () => `'Field' oder 'EndType' erwartet im Type-Block`,
  nestedFunction: () => `Funktionen dürfen nicht ineinander verschachtelt werden`,
  funcParenExpected: () => `'(' erwartet nach dem Funktionsnamen (auch leer: Name())`,
  paramListCloseExpected: () => `')' erwartet am Ende der Parameterliste`,
  returnOutsideFunction: () => `'Return' steht außerhalb einer Funktion`,
  closeBracketExpected: () => `']' erwartet`,
  expressionExpected: (found) => `Ausdruck erwartet, '${found}' gefunden`,
  funcCallParenExpected: (name) => `'(' erwartet nach Funktion '${name}'`,
  fieldNameAfterBackslash: () => `Feldname erwartet nach '\\'`,
  includeNeedsProjectBuild: () =>
    `Include funktioniert nur im Projekt-Build (es bindet andere .crumb-Dateien ein)`
}

// English — additive; the en-fallback the IDE needs when its language is English.
const EN_PARSER: ParserMessages = {
  reservedAsRole: (word, role, lower) =>
    `'${word}' is a CRUMB word and can't be a ${ROLE_EN[role]} — write it in lower case, e.g. ${lower}`,
  roleExpected: (role) => `${ROLE_EN[role]} expected`,
  statementNotSupported: (what) => `a statement starting with '${what}' isn't supported yet at this step`,
  didYouMean: (word, canon) =>
    `'${word}' is not a CRUMB word — did you mean '${canon}'? CRUMB is case-sensitive`,
  tokenExpected: (name) => `'${name}' expected`,
  forEqualsExpected: () => `'=' expected in For loop`,
  closeParenExpected: () => `')' expected`,
  assignEqualsExpected: () => `'=' expected (only assignments are supported at this step)`,
  globalEqualsExpected: () => `'=' expected — Global needs a mandatory initialization`,
  constEqualsExpected: () => `'=' expected in Const declaration`,
  dimBracketExpected: () => `'[' expected — Dim needs a size, e.g. Dim feld.b[10]`,
  dimNeedsDimension: () => `Dim needs at least one dimension, e.g. Dim feld.b[10]`,
  dimTooManyDims: () =>
    'The C64 only supports 1- and 2-dimensional arrays. More dimensions need several ' +
    'multiplications per access (the 6502 has no hardware multiply) and quickly cost a ' +
    'lot of RAM. Use a 2D array instead and fold the third dimension into the index ' +
    'yourself (so the cost stays visible).',
  fieldOrEndTypeExpected: () => `'Field' or 'EndType' expected in the Type block`,
  nestedFunction: () => `functions can't be nested inside each other`,
  funcParenExpected: () => `'(' expected after the function name (even if empty: Name())`,
  paramListCloseExpected: () => `')' expected at the end of the parameter list`,
  returnOutsideFunction: () => `'Return' is outside a function`,
  closeBracketExpected: () => `']' expected`,
  expressionExpected: (found) => `expression expected, found '${found}'`,
  funcCallParenExpected: (name) => `'(' expected after function '${name}'`,
  fieldNameAfterBackslash: () => `field name expected after '\\'`,
  includeNeedsProjectBuild: () =>
    `Include only works in a project build (it pulls in other .crumb files)`
}

// German codegen diagnostics — kept byte-identical to the former inline literals.
const DE_CODEGEN: CodegenMessages = {
  funcRedefined: (name) => `Funktion '${name}' ist mehrfach definiert`,
  paramUnknownRecord: (fn, rec, param) =>
    `Funktion '${fn}': unbekannter Record '${rec}' im Parameter '${param}'`,
  unknownFunction: (callee) => `Unbekannte Funktion '${callee}' — fehlt eine 'Function ${callee}…'?`,
  recursion: (name) =>
    `Rekursion ist nicht erlaubt (Funktion '${name}' ruft sich selbst auf) — der 6502 hat keinen echten Variablen-Stack; formuliere es iterativ`,
  narrowing: (where, reason) => `Verkleinerung beim Schreiben in ${where}: ${reason}`,
  narrowByteReason: () => `der Wert passt nicht in ein Byte (.b, 0…255) — höhere Bits gehen verloren`,
  narrowWordReason: () =>
    `ein vorzeichenbehafteter Wert (.i) wird unsigned (.w) — ein negativer Wert wird zu einer großen Zahl`,
  narrowSintReason: () => `ein .w-Wert über 32767 kippt im signed .i ins Negative`,
  drawTextArgs: () => `DrawText erwartet x, y, Ausdruck`,
  colorArg: () => `Color erwartet eine Farbe, z. B. Color WHITE`,
  strArgs: () => `Str$ erwartet eine Zahl: Str$(n)`,
  stringFnArg: (name) => `${name} erwartet ein Argument`,
  stringFnDeferred: (name) =>
    `${name} kommt mit der vollen String-Stufe (Adventure-Phase) — in diesem Schritt noch nicht verfügbar`,
  commandNoMapping: (name) => `Befehl '${name}' hat in diesem Schritt noch kein C-Mapping`,
  graphicsFirstArg: () => `SetMode: erstes Argument muss TEXT oder BITMAP sein`,
  graphicsSecondArg: () => `SetMode: zweites Argument muss HIRES oder MULTICOLOR sein`,
  graphicsBitmapHires: () =>
    `SetMode BITMAP, HIRES ist in Phase 1 nicht vorgesehen (nur TEXT,HIRES | TEXT,MULTICOLOR | BITMAP,MULTICOLOR)`,
  useTilesetName: () =>
    `UseTileset erwartet einen Tileset-Namen in Anführungszeichen, z. B. UseTileset "main"`,
  useTilesetNoProject: (id) =>
    `UseTileset "${id}": kein Projekt-Kontext — Assets können nur in einem Projekt aufgelöst werden`,
  useImageName: () => `UseImage erwartet einen Bild-Namen in Anführungszeichen, z. B. UseImage "titel"`,
  useImageNoProject: (id) =>
    `UseImage "${id}": kein Projekt-Kontext — Bilder können nur in einem Projekt aufgelöst werden`,
  useImageTwice: (active, other) =>
    `UseImage "${other}": das Programm backt schon "${active}" ein — ein Programm kann heute nur EIN Bild zeigen ` +
    `(der C64 hat pro VIC-Bank genau einen Bitmap-Platz; mehrere Bilder brauchen Nachladen von Diskette)`,
  drawImageName: () => `DrawImage erwartet einen Bild-Namen in Anführungszeichen, z. B. DrawImage "titel"`,
  drawImageNoImage: (id) => `DrawImage "${id}": kein Bild eingebacken — vorher UseImage "${id}" aufrufen`,
  drawImageOther: (baked, id) =>
    `DrawImage "${id}": das Programm backt "${baked}" ein, nicht "${id}" — ein Programm kann heute nur EIN Bild zeigen`,
  drawMapName: () => `DrawMap erwartet einen Karten-Namen in Anführungszeichen, z. B. DrawMap "level1"`,
  drawMapNoProject: (id) =>
    `DrawMap "${id}": kein Projekt-Kontext — Karten können nur in einem Projekt aufgelöst werden`,
  drawMapNoTileset: (id) => `DrawMap "${id}": kein Tileset aktiv — vorher UseTileset "…" aufrufen`,
  drawMapTooWide: (id, width, screenW) =>
    `DrawMap "${id}": diese Karte ist ${width} Spalten breit, auf den Bildschirm passen ${screenW}. ` +
    `DrawMap legt ein Bild hin, das auf einen Schirm passt — eine Karte, die breiter ist als der ` +
    `Schirm, ist eine WELT, durch die man läuft: dafür ist UseMap da.`,
  playFieldArgs: () =>
    `PlayField erwartet zwei feste Zeilen, z. B. PlayField 3, 12 — der Raster-Schnitt wird beim ` +
    `Bauen gestellt, deshalb müssen die Zeilen schon beim Bauen feststehen (Zahl oder Const)`,
  playFieldRange: (rows) =>
    `PlayField: die Zeilen müssen zwischen 0 und ${rows - 1} liegen und die erste über der letzten ` +
    `(z. B. PlayField 3, 12 = zehn Kachelzeilen scrollen, darüber und darunter steht das Bild)`,
  playFieldAfterMap: () =>
    `PlayField kommt zu spät: die Welt ist schon eingebacken. Sag zuerst, WELCHER Streifen scrollt ` +
    `(PlayField), dann welche Welt darin läuft (UseMap)`,
  useMapName: () => `UseMap erwartet einen Karten-Namen in Anführungszeichen, z. B. UseMap "level01"`,
  useMapNoProject: (id) =>
    `UseMap "${id}": kein Projekt-Kontext — Karten können nur in einem Projekt aufgelöst werden`,
  useMapNoTileset: (id) => `UseMap "${id}": kein Tileset aktiv — vorher UseTileset "…" aufrufen`,
  useMapNoPlayField: (id) =>
    `UseMap "${id}": kein Spielfeld gesetzt — vorher PlayField sagen, z. B. PlayField 3, 12. ` +
    `Der C64 scrollt einen STREIFEN des Schirms; ohne ihn weiß niemand, welche Zeilen wandern ` +
    `und welche als Punktestand stehenbleiben`,
  useMapTwice: (active, other) =>
    `UseMap "${other}": das Programm betritt schon die Welt "${active}" — ein Programm hat heute ` +
    `EINE scrollende Welt (Levelwechsel braucht Nachladen von Diskette)`,
  setCameraXArgs: () =>
    `SetCameraX erwartet eine X-Position in Welt-Pixeln, z. B. SetCameraX 0 (Levelanfang) ` +
    `oder SetCameraX CameraX() + 1 (die Welt wandert um ein Pixel)`,
  cameraNoWorld: (word) =>
    `${word}: es gibt keine Welt zum Anschauen — die Kamera ist das Fenster auf eine Karte, ` +
    `die mit UseMap betreten wird (davor PlayField, damit klar ist, welcher Streifen scrollt)`,
  animateTileArgs: () => `AnimateTile erwartet kachel, erster_frame, anzahl_frames, tempo`,
  animateTileNoTileset: () => `AnimateTile: kein Tileset aktiv — vorher UseTileset "…" aufrufen`,
  animateTileTooMany: (max) =>
    `AnimateTile: mehr als ${max} gleichzeitig animierte Kacheln — ab der ${max + 1}. ` +
    `bleibt die Kachel stehen. Tipp: eine Kachel animiert ALLE Zellen, die sie zeigen, ` +
    `zugleich — wiederholst Du dieselbe Kachel, kostet das nur einen Platz.`,
  setTileArgs: () => `SetTile erwartet spalte, zeile, tile, farbe`,
  spriteArgs: () => `Sprite erwartet n, x, y (oder n, OFF)`,
  spriteNumberRange: (name) => `${name} erwartet die Sprite-Nummer n (0–7)`,
  useSpriteArgs: () =>
    `UseSprite erwartet einen Slot (0–7) und einen Sprite-Namen, z. B. UseSprite 0, "player"`,
  useSpriteSecondArg: () =>
    `UseSprite: das zweite Argument muss ein Sprite-Name in Anführungszeichen sein, z. B. UseSprite 0, "player"`,
  useSpriteNoProject: (id) =>
    `UseSprite "${id}": kein Projekt-Kontext — Assets können nur in einem Projekt aufgelöst werden`,
  useSpriteSlotRange: (slot) =>
    `UseSprite: Slot ${slot} gibt es nicht — der C64 hat genau 8 Sprite-Slots (0–7)`,
  spriteIslandFull: (id, used, need, free) =>
    `UseSprite "${id}": die Sprite-Insel ist voll. ${used} Blöcke belegt, dieses Sprite ` +
    `braucht ${need} (ein Block je Frame), frei sind nur noch ${free}. Tipp: weniger ` +
    `Frames oder weniger gleichzeitige Sprites — alle Frames müssen zugleich im RAM liegen.`,
  spriteFrameTooHigh: (slot, frame, count) =>
    `Sprite ${slot}, Frame ${frame}: dieses Sprite hat nur ${count} Frame(s) (0–${count - 1}). ` +
    `Ein zu hoher Frame zeigt den Nachbar-Block — kein Absturz, aber wohl nicht gewollt. ` +
    `Tipp: mit 'Mod ${count}' im Bereich bleiben.`,
  unknownArray: (name) => `Unbekanntes Array '${name}' — fehlt ein 'Dim ${name}…'?`,
  arrayIndexCount: (name) => `Array '${name}' erwartet 1 oder 2 Indizes`,
  recordNoField: (cName, field) => `Record '${cName}' hat kein Feld '${field}'`,
  frameLoopNoVWait: () =>
    'Frame-Schleife (While 1) ohne VWait: ohne Frame-Sync läuft die Schleife so ' +
    'schnell wie möglich (Bewegung rast davon, Tearing). Setz ein VWait in die Schleife.',
  forStep0: () => `For … Step 0 würde endlos laufen — der Zähler bewegt sich nie`,
  forDownNeedsSint: (stepVal, declName) =>
    `Abwärts zählen (Step ${stepVal}) braucht einen .i-Zähler — unsigned kennt kein „unter null" (schreib z. B. \`For ${declName}.i = …\`)`,
  forCounterOverflow: (max, typeLabel, byteDeclName) =>
    `Zähler läuft bis ${max} (${typeLabel}-Maximum) und würde beim letzten Schritt überlaufen${
      byteDeclName ? ` — nimm .w für den Zähler (\`For ${byteDeclName}.w = …\`)` : ''
    }`,
  valueFuncNeedsParens: (name) =>
    `'${name}' ist eine Funktion und gibt einen Wert zurück — ruf sie mit Klammern auf, z. B. ${name}(…)`,
  getTileArgs: () => `GetTile erwartet spalte, zeile [, layer]`,
  tileAtArgs: () => `TileAt erwartet px, py`,
  tileSolidArgs: () => `TileSolid erwartet px, py`,
  absArgs: () => `Abs erwartet einen Wert: Abs(n)`,
  minMaxArgs: (isMin) => {
    const fn = isMin ? 'Min' : 'Max'
    return `${fn} erwartet zwei Werte: ${fn}(a, b)`
  },
  joystickDirArg: () => `Joystick erwartet eine Richtung: LEFT, RIGHT, UP, DOWN oder FIRE`,
  joystickBadDir: (name) =>
    `Joystick: '${name}' ist keine Richtung — erlaubt sind LEFT, RIGHT, UP, DOWN, FIRE`,
  keyboardDeferred: (callee) =>
    `${callee} kommt mit der Tastatur-Eingabe (eigener Milestone): die C64-Tastaturmatrix ` +
    'und die Tasten-Konstanten sind noch nicht verdrahtet. Joystick() funktioniert bereits.',
  recordReturnInExpr: (callee, returnRecord) =>
    `Funktion '${callee}' gibt einen Record zurück — weise sie direkt einer Record-Variable zu (r.${returnRecord} = ${callee}(…)), nicht mitten in einem Ausdruck`,
  funcNoMapping: (callee) => `Funktion '${callee}' hat in diesem Schritt noch kein C-Mapping`,
  getTileLayerConst: () => `GetTile: layer muss 0 oder 1 sein (fester Wert)`
}

// English codegen diagnostics — additive.
const EN_CODEGEN: CodegenMessages = {
  funcRedefined: (name) => `function '${name}' is defined more than once`,
  paramUnknownRecord: (fn, rec, param) =>
    `function '${fn}': unknown record '${rec}' in parameter '${param}'`,
  unknownFunction: (callee) => `unknown function '${callee}' — is a 'Function ${callee}…' missing?`,
  recursion: (name) =>
    `recursion is not allowed (function '${name}' calls itself) — the 6502 has no real variable stack; rewrite it iteratively`,
  narrowing: (where, reason) => `narrowing when writing to ${where}: ${reason}`,
  narrowByteReason: () => `the value doesn't fit in a byte (.b, 0–255) — the high bits are lost`,
  narrowWordReason: () =>
    `a signed value (.i) becomes unsigned (.w) — a negative value turns into a large number`,
  narrowSintReason: () => `a .w value above 32767 flips negative in a signed .i`,
  drawTextArgs: () => `DrawText expects x, y, expression`,
  colorArg: () => `Color expects a colour, e.g. Color WHITE`,
  strArgs: () => `Str$ expects a number: Str$(n)`,
  stringFnArg: (name) => `${name} expects one argument`,
  stringFnDeferred: (name) =>
    `${name} comes with the full string stage (adventure phase) — not available yet at this step`,
  commandNoMapping: (name) => `command '${name}' has no C mapping yet at this step`,
  graphicsFirstArg: () => `SetMode: the first argument must be TEXT or BITMAP`,
  graphicsSecondArg: () => `SetMode: the second argument must be HIRES or MULTICOLOR`,
  graphicsBitmapHires: () =>
    `SetMode BITMAP, HIRES isn't planned for Phase 1 (only TEXT,HIRES | TEXT,MULTICOLOR | BITMAP,MULTICOLOR)`,
  useTilesetName: () => `UseTileset expects a tileset name in quotes, e.g. UseTileset "main"`,
  useTilesetNoProject: (id) =>
    `UseTileset "${id}": no project context — assets can only be resolved inside a project`,
  useImageName: () => `UseImage expects an image name in quotes, e.g. UseImage "title"`,
  useImageNoProject: (id) =>
    `UseImage "${id}": no project context — images can only be resolved inside a project`,
  useImageTwice: (active, other) =>
    `UseImage "${other}": the program already bakes "${active}" — a program can show only ONE image today ` +
    `(the C64 has exactly one bitmap slot per VIC bank; more images need loading from disk)`,
  drawImageName: () => `DrawImage expects an image name in quotes, e.g. DrawImage "title"`,
  drawImageNoImage: (id) => `DrawImage "${id}": no image baked — call UseImage "${id}" first`,
  drawImageOther: (baked, id) =>
    `DrawImage "${id}": the program bakes "${baked}", not "${id}" — a program can show only ONE image today`,
  drawMapName: () => `DrawMap expects a map name in quotes, e.g. DrawMap "level1"`,
  drawMapNoProject: (id) =>
    `DrawMap "${id}": no project context — maps can only be resolved inside a project`,
  drawMapNoTileset: (id) => `DrawMap "${id}": no tileset active — call UseTileset "…" first`,
  drawMapTooWide: (id, width, screenW) =>
    `DrawMap "${id}": this map is ${width} columns wide, the screen fits ${screenW}. ` +
    `DrawMap lays down a picture that fits one screen — a map wider than the screen is a ` +
    `WORLD you walk through: that is what UseMap is for.`,
  playFieldArgs: () =>
    `PlayField expects two fixed rows, e.g. PlayField 3, 12 — the raster split is set at build ` +
    `time, so the rows must be known at build time (a number or a Const)`,
  playFieldRange: (rows) =>
    `PlayField: the rows must lie between 0 and ${rows - 1}, first above last ` +
    `(e.g. PlayField 3, 12 = ten tile rows scroll, above and below the picture stands still)`,
  playFieldAfterMap: () =>
    `PlayField comes too late: the world is already baked. First say WHICH strip scrolls ` +
    `(PlayField), then which world runs inside it (UseMap)`,
  useMapName: () => `UseMap expects a map name in quotes, e.g. UseMap "level01"`,
  useMapNoProject: (id) =>
    `UseMap "${id}": no project context — maps can only be resolved inside a project`,
  useMapNoTileset: (id) => `UseMap "${id}": no tileset active — call UseTileset "…" first`,
  useMapNoPlayField: (id) =>
    `UseMap "${id}": no play field set — say PlayField first, e.g. PlayField 3, 12. The C64 ` +
    `scrolls a STRIP of the screen; without it nobody knows which rows travel and which stand ` +
    `still as your score line`,
  useMapTwice: (active, other) =>
    `UseMap "${other}": the program already enters the world "${active}" — a program has ONE ` +
    `scrolling world today (changing levels needs loading from disk)`,
  setCameraXArgs: () =>
    `SetCameraX expects an x position in world pixels, e.g. SetCameraX 0 (start of the level) ` +
    `or SetCameraX CameraX() + 1 (the world travels by one pixel)`,
  cameraNoWorld: (word) =>
    `${word}: there is no world to look at — the camera is the window onto a map, and a map ` +
    `is entered with UseMap (after PlayField, so it is clear which strip scrolls)`,
  animateTileArgs: () => `AnimateTile expects tile, first_frame, frame_count, tempo`,
  animateTileNoTileset: () => `AnimateTile: no tileset active — call UseTileset "…" first`,
  animateTileTooMany: (max) =>
    `AnimateTile: more than ${max} tiles animated at once — from the ${max + 1}th on the ` +
    `tile stays still. Tip: one tile animates EVERY cell showing it at once, so repeating ` +
    `the same tile costs only one slot.`,
  setTileArgs: () => `SetTile expects column, row, tile, colour`,
  spriteArgs: () => `Sprite expects n, x, y (or n, OFF)`,
  spriteNumberRange: (name) => `${name} expects the sprite number n (0–7)`,
  useSpriteArgs: () => `UseSprite expects a slot (0–7) and a sprite name, e.g. UseSprite 0, "player"`,
  useSpriteSecondArg: () =>
    `UseSprite: the second argument must be a sprite name in quotes, e.g. UseSprite 0, "player"`,
  useSpriteNoProject: (id) =>
    `UseSprite "${id}": no project context — assets can only be resolved inside a project`,
  useSpriteSlotRange: (slot) =>
    `UseSprite: slot ${slot} doesn't exist — the C64 has exactly 8 sprite slots (0–7)`,
  spriteIslandFull: (id, used, need, free) =>
    `UseSprite "${id}": the sprite island is full. ${used} blocks used, this sprite needs ` +
    `${need} (one block per frame), but only ${free} are free. Tip: fewer frames or fewer ` +
    `simultaneous sprites — every frame has to live in RAM at the same time.`,
  spriteFrameTooHigh: (slot, frame, count) =>
    `Sprite ${slot}, frame ${frame}: this sprite has only ${count} frame(s) (0–${count - 1}). ` +
    `A frame past the end shows the neighbouring block — no crash, but probably not intended. ` +
    `Tip: keep it in range with 'Mod ${count}'.`,
  unknownArray: (name) => `unknown array '${name}' — is a 'Dim ${name}…' missing?`,
  arrayIndexCount: (name) => `array '${name}' expects 1 or 2 indices`,
  recordNoField: (cName, field) => `record '${cName}' has no field '${field}'`,
  frameLoopNoVWait: () =>
    'frame loop (While 1) without VWait: with no frame sync the loop runs as fast as ' +
    'possible (movement races away, tearing). Put a VWait in the loop.',
  forStep0: () => `For … Step 0 would loop forever — the counter never moves`,
  forDownNeedsSint: (stepVal, declName) =>
    `counting down (Step ${stepVal}) needs an .i counter — unsigned has no "below zero" (write e.g. \`For ${declName}.i = …\`)`,
  forCounterOverflow: (max, typeLabel, byteDeclName) =>
    `counter runs up to ${max} (${typeLabel} maximum) and would overflow on the last step${
      byteDeclName ? ` — use .w for the counter (\`For ${byteDeclName}.w = …\`)` : ''
    }`,
  valueFuncNeedsParens: (name) =>
    `'${name}' is a function and returns a value — call it with parentheses, e.g. ${name}(…)`,
  getTileArgs: () => `GetTile expects column, row [, layer]`,
  tileAtArgs: () => `TileAt expects px, py`,
  tileSolidArgs: () => `TileSolid expects px, py`,
  absArgs: () => `Abs expects a value: Abs(n)`,
  minMaxArgs: (isMin) => {
    const fn = isMin ? 'Min' : 'Max'
    return `${fn} expects two values: ${fn}(a, b)`
  },
  joystickDirArg: () => `Joystick expects a direction: LEFT, RIGHT, UP, DOWN or FIRE`,
  joystickBadDir: (name) =>
    `Joystick: '${name}' is not a direction — allowed are LEFT, RIGHT, UP, DOWN, FIRE`,
  keyboardDeferred: (callee) =>
    `${callee} comes with keyboard input (its own milestone): the C64 keyboard matrix ` +
    'and the key constants are not wired up yet. Joystick() already works.',
  recordReturnInExpr: (callee, returnRecord) =>
    `function '${callee}' returns a record — assign it directly to a record variable (r.${returnRecord} = ${callee}(…)), not in the middle of an expression`,
  funcNoMapping: (callee) => `function '${callee}' has no C mapping yet at this step`,
  getTileLayerConst: () => `GetTile: layer must be 0 or 1 (a fixed value)`
}

// German asset-resolver diagnostics — kept byte-identical to the former inline literals.
const DE_RESOLVER: ResolverMessages = {
  labelTileset: 'Tileset',
  labelMap: 'Karte',
  labelSprite: 'Sprite',
  labelPalette: 'Palette',
  labelImage: 'Bild',
  noneKnown: '(keine)',
  unknownTileset: (id, hint) => `unbekanntes Tileset '${id}' — Projekt kennt: ${hint}`,
  tilesetFileMissing: (rel) => `Tileset-Datei fehlt: ${rel}`,
  charByteCountWrong: (rel, index, bytes) => `Tileset '${rel}', Zeichen ${index}: erwartet ${bytes} Bytes`,
  charByteBad: (rel, index, byteIndex) =>
    `Tileset '${rel}', Zeichen ${index}, Byte ${byteIndex}: kein gültiger Bytewert (0–255)`,
  unknownMap: (id, hint) => `unbekannte Karte '${id}' — Projekt kennt: ${hint}`,
  mapFileMissing: (rel) => `Karten-Datei fehlt: ${rel}`,
  tileNumberBad: (rel, cell) => `Karte '${rel}', Zelle ${cell}: keine gültige Kachel-Nummer (0–255)`,
  colorRamBad: (rel, cell) => `Karte '${rel}', Zelle ${cell}: kein gültiger Farb-Index (0–15)`,
  unknownSprite: (id, hint) => `unbekanntes Sprite '${id}' — Projekt kennt: ${hint}`,
  spriteFileMissing: (rel) => `Sprite-Datei fehlt: ${rel}`,
  spriteNoFrames: (rel) => `Sprite '${rel}' hat keine 'frames'-Daten`,
  spriteFrameLenWrong: (rel, frame, bytes) => `Sprite '${rel}', Frame ${frame}: erwartet ${bytes} Bytes`,
  spriteByteBad: (rel, frame, byteIndex) =>
    `Sprite '${rel}', Frame ${frame}, Byte ${byteIndex}: kein gültiger Bytewert (0–255)`,
  paletteIndexBad: (rel, field) => `Palette '${rel}', ${field}: kein gültiger Farb-Index (0–15)`,
  unknownImage: (id, hint) => `unbekanntes Bild '${id}' — Projekt kennt: ${hint}`,
  imageFileMissing: (rel) => `Bild-Datei fehlt: ${rel}`,
  imageSectionLenWrong: (rel, section, bytes) => `Bild '${rel}', ${section}: erwartet ${bytes} Bytes`,
  imageByteBad: (rel, section, index) =>
    `Bild '${rel}', ${section}, Byte ${index}: kein gültiger Bytewert (0–255)`,
  imageBackgroundBad: (rel) => `Bild '${rel}', Hintergrund: kein gültiger Farb-Index (0–15)`
}

// English asset-resolver diagnostics — additive.
const EN_RESOLVER: ResolverMessages = {
  labelTileset: 'tileset',
  labelMap: 'map',
  labelSprite: 'sprite',
  labelPalette: 'palette',
  labelImage: 'image',
  noneKnown: '(none)',
  unknownTileset: (id, hint) => `unknown tileset '${id}' — project knows: ${hint}`,
  tilesetFileMissing: (rel) => `tileset file missing: ${rel}`,
  charByteCountWrong: (rel, index, bytes) => `tileset '${rel}', char ${index}: expected ${bytes} bytes`,
  charByteBad: (rel, index, byteIndex) =>
    `tileset '${rel}', char ${index}, byte ${byteIndex}: not a valid byte value (0–255)`,
  unknownMap: (id, hint) => `unknown map '${id}' — project knows: ${hint}`,
  mapFileMissing: (rel) => `map file missing: ${rel}`,
  tileNumberBad: (rel, cell) => `map '${rel}', cell ${cell}: not a valid tile number (0–255)`,
  colorRamBad: (rel, cell) => `map '${rel}', cell ${cell}: not a valid colour index (0–15)`,
  unknownSprite: (id, hint) => `unknown sprite '${id}' — project knows: ${hint}`,
  spriteFileMissing: (rel) => `sprite file missing: ${rel}`,
  spriteNoFrames: (rel) => `sprite '${rel}' has no 'frames' data`,
  spriteFrameLenWrong: (rel, frame, bytes) => `sprite '${rel}', frame ${frame}: expected ${bytes} bytes`,
  spriteByteBad: (rel, frame, byteIndex) =>
    `sprite '${rel}', frame ${frame}, byte ${byteIndex}: not a valid byte value (0–255)`,
  paletteIndexBad: (rel, field) => `palette '${rel}', ${field}: not a valid colour index (0–15)`,
  unknownImage: (id, hint) => `unknown image '${id}' — project knows: ${hint}`,
  imageFileMissing: (rel) => `image file missing: ${rel}`,
  imageSectionLenWrong: (rel, section, bytes) => `image '${rel}', ${section}: expected ${bytes} bytes`,
  imageByteBad: (rel, section, index) =>
    `image '${rel}', ${section}, byte ${index}: not a valid byte value (0–255)`,
  imageBackgroundBad: (rel) => `image '${rel}', background: not a valid colour index (0–15)`
}

// German include diagnostics (B3 Include).
const DE_INCLUDE: IncludeMessages = {
  includeNeedsPath: () =>
    `Include braucht einen Dateinamen in Anführungszeichen, z. B. Include "physics"`,
  includeExtraTokens: () => `nach dem Include-Dateinamen darf nichts weiter stehen`,
  includeNotTopLevel: () =>
    `Include darf nur auf der obersten Ebene stehen — nicht in einer Funktion oder einem Block`,
  includeEscape: (raw) => `Include-Pfad '${raw}' darf das Projekt nicht mit '..' verlassen`,
  includeAbsolute: (raw) =>
    `Include-Pfad '${raw}' muss relativ zur Projekt-Wurzel sein (kein '/' oder Laufwerk am Anfang)`,
  includeEmpty: () => `leerer Include-Pfad`,
  includeMissing: (path, from) => `Include-Datei nicht gefunden: '${path}' (eingebunden in ${from})`,
  includeCycle: (chain) => `Include-Zyklus: ${chain}`
}

// English include diagnostics — additive.
const EN_INCLUDE: IncludeMessages = {
  includeNeedsPath: () => `Include needs a file name in quotes, e.g. Include "physics"`,
  includeExtraTokens: () => `nothing may follow the Include file name`,
  includeNotTopLevel: () =>
    `Include may only appear at the top level — not inside a function or a block`,
  includeEscape: (raw) => `Include path '${raw}' must not climb out of the project with '..'`,
  includeAbsolute: (raw) =>
    `Include path '${raw}' must be relative to the project root (no leading '/' or drive letter)`,
  includeEmpty: () => `empty Include path`,
  includeMissing: (path, from) => `Include file not found: '${path}' (included from ${from})`,
  includeCycle: (chain) => `Include cycle: ${chain}`
}

const DE: Catalog = {
  lexer: DE_LEXER,
  parser: DE_PARSER,
  codegen: DE_CODEGEN,
  resolver: DE_RESOLVER,
  include: DE_INCLUDE
}
const EN: Catalog = {
  lexer: EN_LEXER,
  parser: EN_PARSER,
  codegen: EN_CODEGEN,
  resolver: EN_RESOLVER,
  include: EN_INCLUDE
}

/** The diagnostic catalog for a locale (German is the default; English is additive). */
export function messages(locale: Locale = DEFAULT_LOCALE): Catalog {
  return locale === 'en' ? EN : DE
}
