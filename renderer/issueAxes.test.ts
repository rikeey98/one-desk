import { describe, it, expect } from 'vitest'
import {
  PRIORITY_ORDER, SOURCE_ORDER, KIND_ORDER,
  PRIORITY_LABELS, SOURCE_LABELS, KIND_LABELS
} from './issueAxes'

describe('축 라벨', () => {
  it('순서 배열이 라벨 표의 키를 빠짐없이 담는다', () => {
    expect([...PRIORITY_ORDER].sort()).toEqual(Object.keys(PRIORITY_LABELS).sort())
    expect([...SOURCE_ORDER].sort()).toEqual(Object.keys(SOURCE_LABELS).sort())
    expect([...KIND_ORDER].sort()).toEqual(Object.keys(KIND_LABELS).sort())
  })

  it('급함은 급한 순서다', () => {
    expect(PRIORITY_ORDER).toEqual(['urgent', 'week', 'someday'])
  })
})
