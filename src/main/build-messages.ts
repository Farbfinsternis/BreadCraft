/**
 * Localized console-log strings for the build orchestration (build.ts).
 *
 * The transpiler's DIAGNOSTICS already follow the UI language (STAHL S5b); this is
 * the matching catalogue for the orchestration around them — "Transpiling …",
 * "Build succeeded", the RAM line, the VICE launch — so an English UI never gets a
 * wall of German in the output console (and vice versa). Same de/en shape as the
 * transpiler's `messages.ts`; the German wording is kept verbatim from the original
 * hard-coded strings, English is the added twin.
 */
import type { Locale } from '../shared/ipc'

export interface BuildMessages {
  transpiling: string
  transpileFailed: string
  cc65Missing: string
  cWritten(path: string): string
  tooLarge(overflowBytes: number): string
  cc65Failed: string
  buildOk(prgPath: string): string
  ramLine(used: number, budget: number, ceilingHex: string): string
  buildOnlySkipped: string
  viceDetected(vicePath: string): string
  noVicePath: string
  startingVice(vicePath: string, prgPath: string): string
  viceStarted: string
  viceStartFailed(detail: string): string
  /** The launch never got off the ground (no process id) — the detail for the line above. */
  viceStartNoPid(vicePath: string): string
}

const DE: BuildMessages = {
  transpiling: 'Transpiliere .crumb → C …',
  transpileFailed: 'Transpilieren fehlgeschlagen.',
  cc65Missing: 'Gebündelter cc65 nicht gefunden (resources/cc65/bin/cl65).',
  cWritten: (path) => `C geschrieben: ${path}`,
  tooLarge: (over) =>
    `Zu groß für den Speicher: dein Programm überschreitet den nutzbaren Bereich um ${over} Bytes. Mach den Code/die Assets kleiner — oder die Health-Bar zeigt, wie nah du an der Grenze bist.`,
  cc65Failed: 'cc65-Build fehlgeschlagen.',
  buildOk: (prgPath) => `Build erfolgreich → ${prgPath}`,
  ramLine: (used, budget, ceilingHex) =>
    `RAM: ${used} von ${budget} Bytes belegt (bis $${ceilingHex})`,
  buildOnlySkipped: '.prg gebaut — Start übersprungen (nur Build).',
  viceDetected: (vicePath) => `VICE automatisch gefunden: ${vicePath}`,
  noVicePath: 'Kein gültiger VICE-Pfad gesetzt — .prg gebaut, aber nicht gestartet.',
  startingVice: (vicePath, prgPath) => `Starte VICE: ${vicePath} "${prgPath}"`,
  viceStarted: 'VICE gestartet.',
  viceStartFailed: (detail) => `VICE-Start fehlgeschlagen: ${detail}`,
  viceStartNoPid: (vicePath) =>
    `Windows hat "${vicePath}" nicht gestartet (kein Prozess entstanden). ` +
    `Steht der Pfad noch? Blockiert ein Virenscanner? Starte VICE einmal von Hand — ` +
    `geht das, liegt es nicht an VICE.`
}

const EN: BuildMessages = {
  transpiling: 'Transpiling .crumb → C …',
  transpileFailed: 'Transpiling failed.',
  cc65Missing: 'Bundled cc65 not found (resources/cc65/bin/cl65).',
  cWritten: (path) => `C written: ${path}`,
  tooLarge: (over) =>
    `Too large for memory: your program exceeds the usable area by ${over} bytes. Make the code/assets smaller — or watch the health bar to see how close you are to the limit.`,
  cc65Failed: 'cc65 build failed.',
  buildOk: (prgPath) => `Build succeeded → ${prgPath}`,
  ramLine: (used, budget, ceilingHex) =>
    `RAM: ${used} of ${budget} bytes used (up to $${ceilingHex})`,
  buildOnlySkipped: '.prg built — launch skipped (build only).',
  viceDetected: (vicePath) => `VICE found automatically: ${vicePath}`,
  noVicePath: 'No valid VICE path set — .prg built, but not launched.',
  startingVice: (vicePath, prgPath) => `Starting VICE: ${vicePath} "${prgPath}"`,
  viceStarted: 'VICE started.',
  viceStartFailed: (detail) => `VICE launch failed: ${detail}`,
  viceStartNoPid: (vicePath) =>
    `Windows did not start "${vicePath}" (no process appeared). Is the path still right? ` +
    `Is a virus scanner blocking it? Start VICE by hand once — if that works, VICE isn't the problem.`
}

/** The build-log strings for a UI locale (only German maps to German; anything
 *  else — like the transpiler's own fallback — gets English). */
export function buildMessages(locale: Locale): BuildMessages {
  return locale === 'de' ? DE : EN
}
