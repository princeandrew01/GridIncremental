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
  // exactly 3 significant figures. `.toFixed(2)` rounds, though, and a
  // mantissa of e.g. 9.996 rounds to "10.00" - which has to bump the
  // exponent and rescale, or it prints as the nonsensical "10.00e5" instead
  // of "1.00e6". 9.995 is the exact rounding threshold for 2 decimal places.
  const overflow = n.mantissa >= 9.995
  const mantissa = overflow ? n.mantissa / 10 : n.mantissa
  const exponent = overflow ? n.exponent + 1 : n.exponent
  return `${mantissa.toFixed(2)}e${exponent}`
}

/** Like scientific, but the exponent is always a multiple of 3 (mantissa ranges 1-999.99 instead of 1-9.99). */
function formatEngineering(n: Decimal): string {
  const exponent = n.exponent
  const r = ((exponent % 3) + 3) % 3 // non-negative remainder even if exponent were ever negative
  let engExponent = exponent - r
  let engMantissa = n.mantissa * 10 ** r
  // Same rounding-overflow fix as formatScientific, just at the 999.995
  // threshold (3-digit mantissa) instead of 9.995 (1-digit) - a mantissa of
  // 999.996 would otherwise print as "1000.00e..." instead of rolling to
  // the next multiple-of-3 exponent.
  if (engMantissa >= 999.995) {
    engMantissa /= 1000
    engExponent += 3
  }
  return `${engMantissa.toFixed(2)}e${engExponent}`
}

/** K/M/B/T, then straight to scientific notation - no further suffix tiers past T. */
function formatSuffix(n: Decimal): string {
  const exponent = n.exponent
  let tier = Math.floor(exponent / 3)
  let suffix = suffixForTier(tier)
  if (suffix === null) return formatScientific(n)
  const r = exponent - tier * 3
  let mantissa = n.mantissa * 10 ** r
  // Same rounding-overflow fix as the other two formatters, at the same
  // 999.995 threshold - without this, a value like 999,999 rounded to
  // "1000.00K" instead of rolling to the next tier as "1.00M" (the bug
  // report this fixes).
  if (mantissa >= 999.995) {
    mantissa /= 1000
    tier += 1
    const nextSuffix = suffixForTier(tier)
    if (nextSuffix === null) return formatScientific(n) // rolled past T (1e15) - scientific takes over there anyway
    suffix = nextSuffix
  }
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
