import { formatTokens, formatCost, padZero, formatLocalDate, toSyncDatetime } from '@/lib/formatUtils'

describe('formatTokens()', () => {
  it('returns "0" for zero', () => {
    expect(formatTokens(0)).toBe('0')
  })

  it('returns locale string for values below 1000', () => {
    expect(formatTokens(999)).toBe('999')
  })

  it('formats 1000 as 1.0K', () => {
    expect(formatTokens(1000)).toBe('1.0K')
  })

  it('formats 1500 as 1.5K', () => {
    expect(formatTokens(1500)).toBe('1.5K')
  })

  it('formats 1000000 as 1.00M', () => {
    expect(formatTokens(1_000_000)).toBe('1.00M')
  })

  it('formats 2500000 as 2.50M', () => {
    expect(formatTokens(2_500_000)).toBe('2.50M')
  })
})

describe('formatCost()', () => {
  it('returns "$0.000" for zero', () => {
    expect(formatCost(0)).toBe('$0.000')
  })

  it('returns "<$0.001" for very small values', () => {
    expect(formatCost(0.0001)).toBe('<$0.001')
  })

  it('formats sub-dollar values with 3 decimals', () => {
    expect(formatCost(0.5)).toBe('$0.500')
  })

  it('formats values >= 1 with 2 decimals', () => {
    expect(formatCost(1.5)).toBe('$1.50')
  })

  it('formats 99.99 as $99.99', () => {
    expect(formatCost(99.99)).toBe('$99.99')
  })
})

describe('padZero()', () => {
  it('pads single digit 0 to "00"', () => {
    expect(padZero(0)).toBe('00')
  })

  it('pads single digit 5 to "05"', () => {
    expect(padZero(5)).toBe('05')
  })

  it('keeps two-digit number 10 as "10"', () => {
    expect(padZero(10)).toBe('10')
  })

  it('keeps two-digit number 99 as "99"', () => {
    expect(padZero(99)).toBe('99')
  })
})

describe('formatLocalDate()', () => {
  it('formats a specific date as YYYY-MM-DD', () => {
    const d = new Date(2024, 0, 5) // Jan 5, 2024 (local)
    expect(formatLocalDate(d)).toBe('2024-01-05')
  })

  it('formats a date with double-digit month and day', () => {
    const d = new Date(2025, 11, 25) // Dec 25, 2025
    expect(formatLocalDate(d)).toBe('2025-12-25')
  })
})

describe('toSyncDatetime()', () => {
  const fallback = 'N/A'

  it('returns fallback for null input', () => {
    expect(toSyncDatetime(null, fallback)).toBe(fallback)
  })

  it('returns fallback for empty string', () => {
    expect(toSyncDatetime('', fallback)).toBe(fallback)
  })

  it('returns fallback for invalid ISO string', () => {
    expect(toSyncDatetime('not-a-date', fallback)).toBe(fallback)
  })

  it('formats a valid ISO string to "YYYY-MM-DD HH:mm" in UTC', () => {
    // 2024-03-15T14:30:00Z → "2024-03-15 14:30"
    expect(toSyncDatetime('2024-03-15T14:30:00Z', fallback)).toBe('2024-03-15 14:30')
  })

  it('handles midnight UTC correctly', () => {
    expect(toSyncDatetime('2025-01-01T00:00:00Z', fallback)).toBe('2025-01-01 00:00')
  })
})
