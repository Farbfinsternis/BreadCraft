import { describe, it, expect } from 'vitest'
import { searchDocs } from './search'

describe('docs search', () => {
  // Words that live only in a heading, only in prose, and only in a code example —
  // each must surface, and crucially must SHOW the term in what the user sees.
  const queries = ['border', 'zaubern', 'Theater', 'BorderColor', 'Schleife', 'Farbe', 'leben']

  for (const q of queries) {
    it(`"${q}" returns hits that visibly contain the term`, () => {
      const res = searchDocs(q, 'de')
      expect(res.length, `expected at least one hit for "${q}"`).toBeGreaterThan(0)
      const lc = q.toLowerCase()
      for (const r of res) {
        // A result must show the match in something the user actually sees: the label,
        // the context line (a reference signature) or the snippet — never purely hidden
        // text (the old false-positive feel).
        const visible =
          r.label.toLowerCase().includes(lc) ||
          r.context.toLowerCase().includes(lc) ||
          r.snippet.toLowerCase().includes(lc)
        expect(visible, `hit "${r.label}" shows the term nowhere visible`).toBe(true)
        // When a snippet is shown, the term must sit near its START — otherwise the
        // two-line clamp in the UI would hide the highlighted word (the "border" bug).
        if (r.snippet) {
          const at = r.snippet.toLowerCase().indexOf(lc)
          expect(at, `term too deep in snippet "${r.snippet}"`).toBeLessThanOrEqual(24)
        }
      }
    })
  }

  it('returns nothing for a word that is not in the docs', () => {
    expect(searchDocs('xyzzyqux', 'de')).toHaveLength(0)
  })

  it('returns nothing for an empty query', () => {
    expect(searchDocs('   ', 'de')).toHaveLength(0)
  })
})
