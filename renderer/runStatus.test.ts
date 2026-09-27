import { describe, it, expect } from 'vitest'
import { RUN_STATUS_LABELS } from './runStatus'
import type { RunStatus } from '@shared/models'

const ALL: RunStatus[] = ['pending', 'running', 'succeeded', 'failed', 'canceled', 'interrupted']

describe('RUN_STATUS_LABELS', () => {
  it('run 상태 여섯을 전부 덮는다', () => {
    expect(Object.keys(RUN_STATUS_LABELS).sort()).toEqual([...ALL].sort())
  })

  it('영어 enum이 화면에 나가지 않는다', () => {
    for (const status of ALL) {
      const label = RUN_STATUS_LABELS[status]
      expect(label, status).not.toBe(status)
      expect(label, status).not.toMatch(/[a-z]/i)
    }
  })

  it('spec FR-45의 이름이다', () => {
    expect(RUN_STATUS_LABELS).toEqual({
      pending: '대기 중',
      running: '실행 중',
      succeeded: '완료',
      failed: '실패',
      canceled: '취소됨',
      interrupted: '중단됨'
    })
  })

  it('이름이 서로 겹치지 않는다', () => {
    expect(new Set(Object.values(RUN_STATUS_LABELS)).size).toBe(ALL.length)
  })
})
