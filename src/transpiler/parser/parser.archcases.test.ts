import { describe, it, expect } from 'vitest'
import rawSsot from '@shared/breadcraft.lang.json'
import { buildVocabulary } from '@shared/vocabulary'
import type { Ssot, VocabItem } from '@shared/ssot-types'
import { compile } from '../index'

// ── M0.T1: das EISEN-Sicherheitsnetz ────────────────────────────────────────
// Die 19 Architektur-Schmerzfälle aus _intern/probe/arch.ts, fest als Test.
// Sie sind die ABNAHME-DEFINITION für den ganzen Parser-Neubau (M2):
//
//   it        = der Fall verhält sich HEUTE schon wie definiert (parst sauber
//               bzw. wirft den definierten Fehler).
//   it.fails  = der Fall MUSS heute scheitern. Der Test läuft trotzdem und ist
//               grün, SOLANGE die Assertion fehlschlägt. Sobald ein M2-Task ihn
//               repariert, beginnt die Assertion zu greifen → `it.fails` schlägt
//               selbst an und ERZWINGT die Promotion auf `it`. Der Flip ist damit
//               sichtbar und unvergessbar (N7).
//
// "Grün" ≠ "alles parst": C5 ist per Sprachdef ein FEHLERfall (Wert-Fn ohne
// Klammern ist illegal). Sein definiertes Ergebnis ist der HILFREICHE Fehlertext
// (M2.T4), nicht erfolgreiches Parsen.
//
// Bewusst noch NICHT hier: Case-Varianten (`if`/`endif`/`vwait` klein → "meintest
// Du…?", `Next = 1` → Reserviert-Fehler). Die kommen erst NACH dem M0.T2-Entscheid
// dazu — diese Suite prüft bisher nur die kanonischen Schreibweisen.
// ─────────────────────────────────────────────────────────────────────────────

const vocab: VocabItem[] = buildVocabulary(rawSsot as unknown as Ssot)

/** Harte Fehler (keine Warnungen) eines Compile-Laufs — die Probe-Semantik. */
function hardErrors(src: string): { stage: string; message: string }[] {
  return compile(src, vocab).errors.filter((e) => e.severity !== 'warn')
}

/** Definiertes Soll für die meisten Fälle: parst ohne harten Fehler. */
function expectParsesClean(src: string): void {
  expect(hardErrors(src)).toEqual([])
}

describe('parser: arch cases (M2-Abnahmenetz)', () => {
  // ── A: If-Varianten (gelöst durch M2.T3 — eine If-Routine) ──
  it('A1: If…Then + Newline-Block + EndIf', () => {
    expectParsesClean(['Global x.b = 1', 'If x > 0 Then', '  x = 2', 'EndIf'].join('\n'))
  })
  it('A2: If…Then : stmt : EndIf (eine Zeile)', () => {
    expectParsesClean(['Global x.b = 1', 'If x > 0 Then : x = 2 : EndIf'].join('\n'))
  })
  it('A3: If : stmt : EndIf ohne Then (eine Zeile)', () => {
    expectParsesClean(['Global x.b = 1', 'If x > 0 : x = 2 : EndIf'].join('\n'))
  })
  it('A4: If…Then stmt (einzeilig, ohne EndIf)', () => {
    expectParsesClean(['Global x.b = 1', 'If x > 0 Then x = 2'].join('\n'))
  })

  // ── B: zwei-Wort-Enden (gelöst durch M2.T1 Normalizer) ──
  it('B1: End If (zwei Woerter)', () => {
    expectParsesClean(['Global x.b = 1', 'If x > 0', '  x = 2', 'End If'].join('\n'))
  })
  it('B2: End Function (zwei Woerter)', () => {
    expectParsesClean(['Function Heal(n.b)', '  Return', 'End Function'].join('\n'))
  })

  // ── C: Aufruf- und Argumentlisten-Varianten (löst M2.T4) ──
  it('C1: Statement-Fn ohne Klammern', () => {
    expectParsesClean(['Function Heal(n.b)', '  Return', 'EndFunction', 'Heal 5'].join('\n'))
  })
  it('C2: Statement-Fn MIT Klammern, 1 Arg', () => {
    expectParsesClean(['Function Heal(n.b)', '  Return', 'EndFunction', 'Heal(5)'].join('\n'))
  })
  it('C3: Statement-Fn MIT Klammern, 2 Args', () => {
    expectParsesClean(['Function Heal(n.b, m.b)', '  Return', 'EndFunction', 'Heal(5, 3)'].join('\n'))
  })
  it('C4: Wert-Fn als Statement (Ergebnis verworfen)', () => {
    expectParsesClean(['Function Dist.w(a.b)', '  Return a', 'EndFunction', 'Dist(3)'].join('\n'))
  })
  // C5 ist ein FEHLERfall: das Soll ist ein HILFREICHER Fehler (M2.T4), nicht
  // sauberes Parsen. Der CodeGen erkennt den nackten Wert-Fn-Namen und nennt die
  // Funktion + verlangt Klammern (zusätzlich zum generischen Parse-Fehler).
  it('C5: Wert-Fn ohne Klammern in Expression (definierter Fehler)', () => {
    const errs = hardErrors(['Function Dist.w(a.b)', '  Return a', 'EndFunction', 'Global y.w = 0', 'y = Dist 3'].join('\n'))
    expect(errs.length).toBeGreaterThan(0)
    expect(errs.map((e) => e.message).join(' ')).toMatch(/Dist|Wert zur(ü|ue)ck|Klammer/i)
  })

  // ── D: Variablen mit SSOT-Wort-Namen (gelöst durch M2.T2 Case-Sensitivität) ──
  // fire ≠ FIRE, next ≠ Next, max ≠ Max: kleingeschrieben sind es freie Bezeichner.
  it('D1: Variable namens fire (SSOT-Konstante)', () => {
    expectParsesClean('fire = 1')
  })
  it('D2: Variable namens next (SSOT-Keyword)', () => {
    expectParsesClean('next = 1')
  })
  it('D3: Variable namens max (SSOT-Funktion)', () => {
    expectParsesClean('max = 1')
  })
  it('D4: fire in Expression lesen', () => {
    expectParsesClean(['fire = 1', 'If fire > 0', '  fire = 0', 'EndIf'].join('\n'))
  })

  // ── E: geklammerte Command-Args (löst M2.T4) ──
  it('E1: Command-Args geklammert: Cls (BLACK)', () => {
    expectParsesClean('Cls (BLACK)')
  })
  it('E2: erstes Arg gruppiert: DrawText (1), 2, "hi"', () => {
    expectParsesClean('DrawText (1), 2, "hi"')
  })

  // ── F: ElseIf-Ketten (löst M2.T3 + Normalizer) ──
  it('F1: ElseIf-Kette', () => {
    expectParsesClean(['Global x.b = 1', 'If x = 1', '  x = 2', 'ElseIf x = 2', '  x = 3', 'Else', '  x = 4', 'EndIf'].join('\n'))
  })
  it('F2: Else If (zwei Woerter)', () => {
    expectParsesClean(['Global x.b = 1', 'If x = 1', '  x = 2', 'Else If x = 2', '  x = 3', 'EndIf'].join('\n'))
  })

  // ── G: Case-Sensitivität (M2.T2) — die NEUEN Fälle (M0.T1-N7) ──
  // Kleingeschriebene CRUMB-Wörter sind keine CRUMB-Wörter mehr; der Parser hilft mit
  // „meintest Du …?", und die kanonische Schreibweise als Ziel ist reserviert.
  const messages = (src: string): string => hardErrors(src).map((e) => e.message).join(' | ')

  it('G1: if (klein) → hilfreicher „meintest Du If?"-Fehler', () => {
    const m = messages(['if x > 0', '  x = 2', 'EndIf'].join('\n'))
    expect(m).toMatch(/meintest Du.*If/i)
    expect(m).toMatch(/Gro(ß|ss)/i) // erklärt, dass es auf Groß-/Kleinschreibung ankommt
  })

  it('G2: endif (klein) → „meintest Du EndIf?"', () => {
    expect(messages(['If x > 0', '  x = 2', 'endif'].join('\n'))).toMatch(/meintest Du.*EndIf/i)
  })

  it('G3: Next = 1 (kanonisch) → Reserviert-Fehler', () => {
    const m = messages('Next = 1')
    expect(m).toMatch(/CRUMB-Wort/i)
    expect(m).toMatch(/Next/)
  })

  it('G4: next/fire/max klein bleiben freie Variablen (Gegenprobe zu G3)', () => {
    expectParsesClean(['next = 1', 'fire = 2', 'max = 3'].join('\n'))
  })
})
