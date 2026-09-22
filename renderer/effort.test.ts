import { describe, it, expect } from 'vitest'
import { EFFORT_OPTIONS, effortFieldOf } from './effort'

describe('EFFORT_OPTIONS', () => {
  it('첫 항목이 빈 값이고 그것이 기본이다', () => {
    // 빈 항목을 빼면 한 번 고른 뒤에는 "CLI 자신의 기본값"으로 되돌릴 수 없다 —
    // 모델 칸을 비우는 것과 같은 자리여야 한다.
    expect(EFFORT_OPTIONS[0]).toEqual({ value: '', label: '기본값' })
  })

  it('claude --help가 열거한 다섯 단계를 그 순서로 담는다', () => {
    expect(EFFORT_OPTIONS.slice(1).map((o) => o.value))
      .toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
  })

  it('값이 겹치지 않는다', () => {
    const values = EFFORT_OPTIONS.map((o) => o.value)
    expect(new Set(values).size).toBe(values.length)
  })
})

describe('effortFieldOf', () => {
  it('claude는 드롭다운이다', () => {
    const field = effortFieldOf('claude-code')
    expect(field.label).toBe('effort')
    expect(field.fixedOptions).toBe(true)
  })

  it('opencode는 자유 입력이고 이름이 variant다', () => {
    // provider마다 값이 달라 다섯 단계 표로 묶으면 그 표가 거짓말이 된다(FR-13).
    const field = effortFieldOf('opencode')
    expect(field.label).toBe('variant')
    expect(field.fixedOptions).toBe(false)
  })
})
