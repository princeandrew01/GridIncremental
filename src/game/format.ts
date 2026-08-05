import Decimal from 'break_infinity.js'

export type NumberFormatMode = 'scientific' | 'engineering' | 'suffix'

const FIXED_SUFFIXES = ['', 'K', 'M', 'B', 'T']

/** K/M/B/T only - anything past T (1e15+) falls straight to scientific notation instead of extending further, see formatSuffix. */
function suffixForTier(tier: number): string | null {
  return tier < FIXED_SUFFIXES.length ? FIXED_SUFFIXES[tier] : null
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

/** K/M/B/T, then straight to scientific notation - no further suffix tiers past T. */
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
 * `engineering` keeps its own convention: thousands separators from 1,000 to
 * 1e6, mod-3-exponent scientific notation above that.
 * `scientific` and `suffix` deliberately produce IDENTICAL output (confirmed
 * with the user): K/M/B/T from 1,000 straight through a trillion, then
 * regular scientific notation past that - see formatSuffix.
 */
export function format(n: Decimal, mode: NumberFormatMode): string {
  if (n.lt(0)) return '-' + format(n.neg(), mode)

  if (mode === 'engineering') {
    if (n.lt(1000)) return formatPlain(n)
    if (n.lt(1e6)) return formatGrouped(n)
    return formatEngineering(n)
  }

  return n.lt(1000) ? formatPlain(n) : formatSuffix(n)
}
