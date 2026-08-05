import Decimal from 'break_infinity.js'

export type NumberFormatMode = 'scientific' | 'engineering' | 'suffix'

const FIXED_SUFFIXES = ['', 'K', 'M', 'B', 'T']

/**
 * Two-letter suffix tiers after T: aa, ab, ..., az, ba, ..., zz - a plain
 * base-26 pair, deliberately skipping single letters (T is immediately
 * followed by aa, not a). Returns null past zz (tier index 675, ~1e2043) -
 * `formatSuffix` falls back to scientific there rather than extending to
 * three letters, well beyond anything this game's current balance will
 * ever reach.
 */
function letterSuffix(index: number): string | null {
  if (index < 0 || index > 675) return null
  const first = String.fromCharCode(97 + Math.floor(index / 26))
  const second = String.fromCharCode(97 + (index % 26))
  return first + second
}

function suffixForTier(tier: number): string | null {
  if (tier < FIXED_SUFFIXES.length) return FIXED_SUFFIXES[tier]
  return letterSuffix(tier - FIXED_SUFFIXES.length)
}

function formatPlain(n: Decimal): string {
  return Math.round(n.toNumber()).toString()
}

function formatGrouped(n: Decimal): string {
  return Math.round(n.toNumber()).toLocaleString('en-US')
}

function formatScientific(n: Decimal): string {
  // Decimal normalises mantissa into [1, 10), so two decimal places is
  // exactly 3 significant figures.
  return `${n.mantissa.toFixed(2)}e${n.exponent}`
}

/** Like scientific, but the exponent is always a multiple of 3 (mantissa ranges 1-999.99 instead of 1-9.99). */
function formatEngineering(n: Decimal): string {
  const exponent = n.exponent
  const r = ((exponent % 3) + 3) % 3 // non-negative remainder even if exponent were ever negative
  const engExponent = exponent - r
  const engMantissa = n.mantissa * 10 ** r
  return `${engMantissa.toFixed(2)}e${engExponent}`
}

/** K/M/B/T, then aa/ab/.../zz. Falls back to scientific beyond the letter table. */
function formatSuffix(n: Decimal): string {
  const exponent = n.exponent
  const tier = Math.floor(exponent / 3)
  const suffix = suffixForTier(tier)
  if (suffix === null) return formatScientific(n)
  const r = exponent - tier * 3
  const mantissa = n.mantissa * 10 ** r
  return `${mantissa.toFixed(2)}${suffix}`
}

/**
 * Below 1,000: as-is, no decimals (rounded, not floored - flooring made
 * small level-up bumps like 1 -> 1.5 display as no visible change at all,
 * which read as a bug).
 * 1,000 to 1e6: thousands separators for scientific/engineering; suffix mode
 * switches straight to K/M notation at 1,000 instead - its own convention.
 * Above 1e6 (and above 1,000 for suffix mode): per `mode`.
 */
export function format(n: Decimal, mode: NumberFormatMode): string {
  if (n.lt(0)) return '-' + format(n.neg(), mode)

  if (mode === 'suffix') {
    return n.lt(1000) ? formatPlain(n) : formatSuffix(n)
  }

  if (n.lt(1000)) return formatPlain(n)
  if (n.lt(1e6)) return formatGrouped(n)
  return mode === 'engineering' ? formatEngineering(n) : formatScientific(n)
}
