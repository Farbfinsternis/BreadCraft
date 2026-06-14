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
  strArgs(): string
  commandNoMapping(name: string): string
  graphicsFirstArg(): string
  graphicsSecondArg(): string
  graphicsBitmapHires(): string
  useTilesetName(): string
  useTilesetNoProject(id: string): string
  drawMapName(): string
  drawMapNoProject(id: string): string
  drawMapNoTileset(id: string): string
  setTileArgs(): string
  spriteArgs(): string
  spriteNumberRange(name: string): string
  useSpriteArgs(): string
  useSpriteSecondArg(): string
  useSpriteNoProject(id: string): string
  useSpriteSlotRange(slot: number): string
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
}

export interface Catalog {
  lexer: LexerMessages
  parser: ParserMessages
  codegen: CodegenMessages
  resolver: ResolverMessages
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
  fieldNameAfterBackslash: () => `Feldname erwartet nach '\\'`
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
  fieldNameAfterBackslash: () => `field name expected after '\\'`
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
  strArgs: () => `Str$ erwartet eine Zahl: Str$(n)`,
  commandNoMapping: (name) => `Befehl '${name}' hat in diesem Schritt noch kein C-Mapping`,
  graphicsFirstArg: () => `Graphics: erstes Argument muss TEXT oder BITMAP sein`,
  graphicsSecondArg: () => `Graphics: zweites Argument muss HIRES oder MULTICOLOR sein`,
  graphicsBitmapHires: () =>
    `Graphics BITMAP, HIRES ist in Phase 1 nicht vorgesehen (nur TEXT,HIRES | TEXT,MULTICOLOR | BITMAP,MULTICOLOR)`,
  useTilesetName: () =>
    `UseTileset erwartet einen Tileset-Namen in Anführungszeichen, z. B. UseTileset "main"`,
  useTilesetNoProject: (id) =>
    `UseTileset "${id}": kein Projekt-Kontext — Assets können nur in einem Projekt aufgelöst werden`,
  drawMapName: () => `DrawMap erwartet einen Karten-Namen in Anführungszeichen, z. B. DrawMap "level1"`,
  drawMapNoProject: (id) =>
    `DrawMap "${id}": kein Projekt-Kontext — Karten können nur in einem Projekt aufgelöst werden`,
  drawMapNoTileset: (id) => `DrawMap "${id}": kein Tileset aktiv — vorher UseTileset "…" aufrufen`,
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
  strArgs: () => `Str$ expects a number: Str$(n)`,
  commandNoMapping: (name) => `command '${name}' has no C mapping yet at this step`,
  graphicsFirstArg: () => `Graphics: the first argument must be TEXT or BITMAP`,
  graphicsSecondArg: () => `Graphics: the second argument must be HIRES or MULTICOLOR`,
  graphicsBitmapHires: () =>
    `Graphics BITMAP, HIRES isn't planned for Phase 1 (only TEXT,HIRES | TEXT,MULTICOLOR | BITMAP,MULTICOLOR)`,
  useTilesetName: () => `UseTileset expects a tileset name in quotes, e.g. UseTileset "main"`,
  useTilesetNoProject: (id) =>
    `UseTileset "${id}": no project context — assets can only be resolved inside a project`,
  drawMapName: () => `DrawMap expects a map name in quotes, e.g. DrawMap "level1"`,
  drawMapNoProject: (id) =>
    `DrawMap "${id}": no project context — maps can only be resolved inside a project`,
  drawMapNoTileset: (id) => `DrawMap "${id}": no tileset active — call UseTileset "…" first`,
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
  paletteIndexBad: (rel, field) => `Palette '${rel}', ${field}: kein gültiger Farb-Index (0–15)`
}

// English asset-resolver diagnostics — additive.
const EN_RESOLVER: ResolverMessages = {
  labelTileset: 'tileset',
  labelMap: 'map',
  labelSprite: 'sprite',
  labelPalette: 'palette',
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
  paletteIndexBad: (rel, field) => `palette '${rel}', ${field}: not a valid colour index (0–15)`
}

const DE: Catalog = { lexer: DE_LEXER, parser: DE_PARSER, codegen: DE_CODEGEN, resolver: DE_RESOLVER }
const EN: Catalog = { lexer: EN_LEXER, parser: EN_PARSER, codegen: EN_CODEGEN, resolver: EN_RESOLVER }

/** The diagnostic catalog for a locale (German is the default; English is additive). */
export function messages(locale: Locale = DEFAULT_LOCALE): Catalog {
  return locale === 'en' ? EN : DE
}
