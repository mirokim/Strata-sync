import { estimateCost, MODEL_PRICING, useUsageStore } from '@/stores/usageStore'

function resetStore() {
  useUsageStore.setState({
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCostUsd: 0,
  })
}

describe('estimateCost()', () => {
  it('returns 0 for an unknown model', () => {
    expect(estimateCost('unknown-model', 1000, 1000)).toBe(0)
  })

  it('calculates cost for claude-sonnet-4-6', () => {
    const pricing = MODEL_PRICING['claude-sonnet-4-6']
    const input = 1_000_000
    const output = 500_000
    const expected = (input / 1_000_000) * pricing.input + (output / 1_000_000) * pricing.output
    expect(estimateCost('claude-sonnet-4-6', input, output)).toBeCloseTo(expected)
  })

  it('calculates cost for gpt-4o', () => {
    const pricing = MODEL_PRICING['gpt-4o']
    // 100K input, 50K output
    const expected = (100_000 / 1_000_000) * pricing.input + (50_000 / 1_000_000) * pricing.output
    expect(estimateCost('gpt-4o', 100_000, 50_000)).toBeCloseTo(expected)
  })

  it('returns 0 cost for zero tokens on a known model', () => {
    expect(estimateCost('gpt-4o', 0, 0)).toBe(0)
  })
})

describe('useUsageStore', () => {
  beforeEach(() => {
    resetStore()
  })

  it('starts with zero counters', () => {
    const state = useUsageStore.getState()
    expect(state.totalInputTokens).toBe(0)
    expect(state.totalOutputTokens).toBe(0)
    expect(state.totalCostUsd).toBe(0)
  })

  describe('recordUsage()', () => {
    it('accumulates token counts', () => {
      const { recordUsage } = useUsageStore.getState()
      recordUsage('gpt-4o', 1000, 500)
      recordUsage('gpt-4o', 2000, 1000)

      const state = useUsageStore.getState()
      expect(state.totalInputTokens).toBe(3000)
      expect(state.totalOutputTokens).toBe(1500)
    })

    it('accumulates cost from multiple calls', () => {
      const { recordUsage } = useUsageStore.getState()
      recordUsage('gpt-4o', 1_000_000, 0)

      const cost1 = useUsageStore.getState().totalCostUsd
      expect(cost1).toBeCloseTo(MODEL_PRICING['gpt-4o'].input)

      recordUsage('gpt-4o', 0, 1_000_000)
      const cost2 = useUsageStore.getState().totalCostUsd
      expect(cost2).toBeCloseTo(MODEL_PRICING['gpt-4o'].input + MODEL_PRICING['gpt-4o'].output)
    })

    it('records zero cost for unknown model but still tracks tokens', () => {
      const { recordUsage } = useUsageStore.getState()
      recordUsage('fake-model', 500, 300)

      const state = useUsageStore.getState()
      expect(state.totalInputTokens).toBe(500)
      expect(state.totalOutputTokens).toBe(300)
      expect(state.totalCostUsd).toBe(0)
    })
  })

  describe('resetSession()', () => {
    it('clears all counters', () => {
      const { recordUsage, resetSession } = useUsageStore.getState()
      recordUsage('gpt-4o', 5000, 2000)
      resetSession()

      const state = useUsageStore.getState()
      expect(state.totalInputTokens).toBe(0)
      expect(state.totalOutputTokens).toBe(0)
      expect(state.totalCostUsd).toBe(0)
    })
  })
})
