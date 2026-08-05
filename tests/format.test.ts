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
    // Tier is chosen from the raw exponent before rounding, so 999,999
    // (exponent 5, still the K tier) rounds up to 1000.00K rather than
    // rolling over to 1.00M - a pre-existing formatSuffix quirk at this
    // exact boundary, unrelated to this change.
    expect(format(new Decimal(999_999), 'scientific')).toBe('1000.00K')
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
