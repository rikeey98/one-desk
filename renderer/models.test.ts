import { describe, it, expect } from 'vitest'
import { CLAUDE_MODEL_SUGGESTIONS, modelPlaceholderOf, modelSuggestionsOf } from './models'

describe('CLAUDE_MODEL_SUGGESTIONS', () => {
  it('비어 있지 않고 중복이 없다', () => {
    expect(CLAUDE_MODEL_SUGGESTIONS.length).toBeGreaterThan(0)
    expect(new Set(CLAUDE_MODEL_SUGGESTIONS).size).toBe(CLAUDE_MODEL_SUGGESTIONS.length)
  })
})

describe('modelSuggestionsOf', () => {
  it('opencode는 조회된 목록을 그대로 쓴다', () => {
    // 382개를 실제로 조회할 수 있다 — 앱이 표를 들고 있을 이유가 없다.
    const probed = ['openrouter/anthropic/claude-sonnet-4.5', 'opencode/big-pickle']
    expect(modelSuggestionsOf('opencode', probed)).toEqual(probed)
  })

  it('opencode에 claude 별칭이 섞이지 않는다', () => {
    // 섞이면 `sonnet`을 골라 provider/model 자리에 넣게 된다(설계 §199).
    expect(modelSuggestionsOf('opencode', [])).toEqual([])
  })

  it('claude는 조회가 없어도 별칭 표를 제안한다', () => {
    expect(modelSuggestionsOf('claude-code', [])).toEqual([...CLAUDE_MODEL_SUGGESTIONS])
  })

  it('claude에 조회된 값이 생기면 앞에 오고 별칭이 중복되지 않는다', () => {
    const result = modelSuggestionsOf('claude-code', ['claude-sonnet-5', 'sonnet'])
    expect(result[0]).toBe('claude-sonnet-5')
    expect(result.filter((m) => m === 'sonnet')).toHaveLength(1)
  })
})

describe('modelPlaceholderOf', () => {
  it('agent마다 예시가 다르다', () => {
    // 형식이 다르다 — claude는 별칭, opencode는 provider/model(설계 §199).
    expect(modelPlaceholderOf('claude-code')).toContain('sonnet')
    expect(modelPlaceholderOf('opencode')).toContain('/')
  })
})
