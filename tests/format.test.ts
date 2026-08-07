import { describe, it, expect } from 'vitest'
import Decimal from 'break_infinity.js'
import { format } from '../src/game/format'

describe('format - shared behaviour across all modes', () => {
  it('below 1000 rounds (not floors) and shows no decimals', () => {
    for (const mode of ['scientific', 'engineering', 'suffix'] as const) {
      expect(format(new Decimal(0), mode)).toBe('0')
      expect(format(new Decimal(1.5), mode)).toBe('2') // rounds up, not floor-to-1
      expect(format(new Decimal(999), mode)).toBe('999')
    }
  })

  it('negative numbers get a leading minus, formatted the same as their positive counterpart', () => {
    expect(format(new Decimal(-1500), 'scientific')).toBe('-1.50K')
    expect(format(new Decimal(-2_500_000), 'scientific')).toBe('-2.50M')
    expect(format(new Decimal(-500), 'engineering')).toBe('-500')
  })
})

describe('format - scientific mode', () => {
  it('deliberately produces identical output to suffix mode (confirmed with the user): K/M/B/T from 1,000, then straight to scientific past a trillion', () => {
    expect(format(new Decimal(1500), 'scientific')).toBe('1.50K')
    // 999,999 rounds to a 2-decimal mantissa of 1000.00 within the K tier -
    // rolls over to the M tier instead of printing the nonsensical
    // "1000.00K" (a real bug, reported and fixed: see the dedicated
    // rounding-overflow tests below).
    expect(format(new Decimal(999_999), 'scientific')).toBe('1.00M')
    expect(format(new Decimal(1_000_000), 'scientific')).toBe('1.00M')
    expect(format(new Decimal(1_230_000_000), 'scientific')).toBe('1.23B')
    expect(format(new Decimal(1e15), 'scientific')).toBe('1.00e15')
    expect(format(Decimal.fromMantissaExponent(1.23456, 350), 'scientific')).toBe('1.23e350')

    for (const n of [1500, 999_999, 1_000_000, 1_230_000_000, 1e15, 1e18]) {
      expect(format(new Decimal(n), 'scientific')).toBe(format(new Decimal(n), 'suffix'))
    }
  })
})

describe('format - engineering mode', () => {
  it('below 1e6: identical to scientific mode (grouped/plain)', () => {
    expect(format(new Decimal(500), 'engineering')).toBe('500')
    expect(format(new Decimal(123_456), 'engineering')).toBe('123,456')
  })

  it('exponent is always a multiple of 3, mantissa 1-999.99', () => {
    expect(format(new Decimal(1_000_000), 'engineering')).toBe('1.00e6') // exponent 6, already a multiple of 3
    expect(format(new Decimal(12_300_000), 'engineering')).toBe('12.30e6') // exponent 7 -> shifts to e6
    expect(format(new Decimal(123_000_000), 'engineering')).toBe('123.00e6') // exponent 8 -> shifts to e6
    expect(format(new Decimal(1_230_000_000), 'engineering')).toBe('1.23e9') // exponent 9, already a multiple of 3
  })
})

describe('format - suffix mode', () => {
  it('switches to K/M notation immediately at 1000, not comma-grouping', () => {
    expect(format(new Decimal(999), 'suffix')).toBe('999')
    expect(format(new Decimal(1500), 'suffix')).toBe('1.50K')
    expect(format(new Decimal(12_345), 'suffix')).toBe('12.34K') // 1.2345e4 -> mantissa*10 isn't exactly 12.345 in floating point
  })

  it('fixed tiers: K, M, B, T', () => {
    expect(format(new Decimal(1_000_000), 'suffix')).toBe('1.00M')
    expect(format(new Decimal(1_000_000_000), 'suffix')).toBe('1.00B')
    expect(format(new Decimal(1_000_000_000_000), 'suffix')).toBe('1.00T')
  })

  it('after T (1e15+), switches straight to scientific notation - no further suffix tiers', () => {
    expect(format(new Decimal(1e15), 'suffix')).toBe('1.00e15')
    expect(format(new Decimal(1e18), 'suffix')).toBe('1.00e18')
    expect(format(new Decimal(1.5e16), 'suffix')).toBe('1.50e16')
  })

  it('stays in scientific for arbitrarily large numbers, rather than crashing or producing garbage', () => {
    const huge = Decimal.fromMantissaExponent(1.5, 3000)
    const result = format(huge, 'suffix')
    expect(result).toBe('1.50e3000')
  })
})

describe('format - rounding-overflow at a tier boundary (bug fix)', () => {
  it('a mantissa that rounds to 1000.00 rolls over to the next suffix tier instead of printing "1000.00X"', () => {
    expect(format(new Decimal(999_999), 'suffix')).toBe('1.00M') // was "1000.00K"
    expect(format(new Decimal(999_999_000), 'suffix')).toBe('1.00B') // was "1000.00M"
    expect(format(new Decimal(999_999_999_999), 'suffix')).toBe('1.00T') // was "1000.00B"
  })

  it('rolling over right at the T/scientific boundary falls through to scientific notation, not a nonexistent 5th tier', () => {
    // 999,999,999,999,999,999,999 has exponent 20 (tier "past T"), but its
    // mantissa (9.99999...) itself doesn't overflow at that exponent - use a
    // value whose K/M/B/T-scaled mantissa specifically rounds to 1000 right
    // at the T ceiling instead.
    const n = new Decimal(999_999).times(new Decimal(10).pow(9)) // 999,999 * 1e9 -> T-tier mantissa 999.999...
    expect(format(n, 'suffix')).toBe('1.00e15')
  })

  it('same fix applies to plain scientific notation past the T ceiling (9.995+ mantissa)', () => {
    // Past 1e15, formatSuffix has no tier left and falls through to
    // formatScientific directly - exercise ITS OWN overflow check (as
    // opposed to formatSuffix's, covered by the tests above).
    expect(format(Decimal.fromMantissaExponent(9.996, 15), 'suffix')).toBe('1.00e16') // was "10.00e15"
  })

  it('same fix applies to engineering mode (999.995+ scaled mantissa)', () => {
    // exponent 8 -> r=2 -> scaled mantissa 9.99996 * 100 = 999.996, rounds to
    // 1000.00 within the e6 bracket - should roll to e9 instead.
    expect(format(Decimal.fromMantissaExponent(9.99996, 8), 'engineering')).toBe('1.00e9') // was "1000.00e6"
  })
})
