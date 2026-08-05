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
    expect(format(new Decimal(-1500), 'scientific')).toBe('-1,500')
    expect(format(new Decimal(-2_500_000), 'scientific')).toBe('-2.50e6')
  })
})

describe('format - scientific mode', () => {
  it('1,000 to 1e6: thousands separators', () => {
    expect(format(new Decimal(1500), 'scientific')).toBe('1,500')
    expect(format(new Decimal(999_999), 'scientific')).toBe('999,999')
  })

  it('1e6 and above: mantissa.XXe{exponent}', () => {
    expect(format(new Decimal(1_000_000), 'scientific')).toBe('1.00e6')
    expect(format(new Decimal(1_230_000_000), 'scientific')).toBe('1.23e9')
    expect(format(Decimal.fromMantissaExponent(1.23456, 350), 'scientific')).toBe('1.23e350')
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

  it('after T, jumps straight to two-letter tiers starting at aa (never a bare single letter)', () => {
    expect(format(new Decimal(1e15), 'suffix')).toBe('1.00aa')
    expect(format(new Decimal(1e18), 'suffix')).toBe('1.00ab')
  })

  it('letter rollover: az -> ba', () => {
    // az is tier index 25 within the letters (26th two-letter tier), at 1e(15+25*3) = 1e90
    expect(format(new Decimal(1e90), 'suffix')).toBe('1.00az')
    expect(format(new Decimal(1e93), 'suffix')).toBe('1.00ba')
  })

  it('falls back to scientific notation past zz, rather than crashing or producing garbage', () => {
    const huge = Decimal.fromMantissaExponent(1.5, 3000)
    const result = format(huge, 'suffix')
    expect(result).toBe('1.50e3000')
  })
})
