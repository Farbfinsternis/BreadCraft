import type { BuildLogLine } from '@shared/ipc'

// B3.T4 — turn the build's located log lines into per-file editor markers. Pure and
// testable: no Monaco, no stores. The code editor is single-model (it shows one file at
// a time), so it only ever marks the diagnostics that belong to the file on screen —
// this picks them out.

export interface FileMarker {
  /** 1-based line/column of the diagnostic. */
  line: number
  col: number
  /** The console text, reused verbatim as the marker's hover message. */
  message: string
  level: 'error' | 'warn'
}

/**
 * The build log lines whose location lands IN `activeRel`, as editor markers. A line
 * with no explicit `file` falls back to `entry` (the entry/single-file case), so a bare
 * `main.crumb` build still marks its own errors.
 */
export function markersForFile(
  lines: BuildLogLine[],
  activeRel: string,
  entry: string
): FileMarker[] {
  const out: FileMarker[] = []
  for (const l of lines) {
    if (!l.loc) continue
    if ((l.loc.file ?? entry) !== activeRel) continue
    out.push({
      line: l.loc.line,
      col: l.loc.col,
      message: l.text,
      level: l.level === 'warn' ? 'warn' : 'error'
    })
  }
  return out
}
