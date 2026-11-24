import { describe, it, expect } from 'vitest'
import { previewOf } from './itemPreview'

describe('previewOf', () => {
  it('본문이 비었거나 공백뿐이면 미리보기가 없다', () => {
    expect(previewOf('')).toBeNull()
    expect(previewOf('  \n\n  ')).toBeNull()
  })

  it('마크다운 머리 기호를 떼고 줄을 가운뎃점으로 잇는다', () => {
    expect(previewOf('## 결정\n- 결제 실패 메일 문구는 이번 주에 정리\n\n> 다음 회의: 12/1'))
      .toBe('결정 · 결제 실패 메일 문구는 이번 주에 정리 · 다음 회의: 12/1')
  })

  it('번호 목록·할 일 상자·별표 목록도 뗀다', () => {
    expect(previewOf('1. 토큰 만료 직전에 로그인\n- [ ] refresh 재시도\n* [x] 안내 문구'))
      .toBe('토큰 만료 직전에 로그인 · refresh 재시도 · 안내 문구')
  })

  it('기호만 있는 줄과 코드 울타리는 건너뛴다', () => {
    expect(previewOf('---\n```ts\nconst a = 1\n```\n본문')).toBe('const a = 1 · 본문')
  })

  it('길면 앞부분만 남긴다 — 줄 끝 말줄임은 CSS가 맡는다', () => {
    const preview = previewOf('가'.repeat(500))
    expect(preview).not.toBeNull()
    expect(preview!.length).toBeLessThanOrEqual(200)
  })
})
