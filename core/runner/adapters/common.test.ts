import { describe, it, expect } from 'vitest'
import type { EditFileDetail } from '@shared/events'
import {
  BEFORE_MAX_CHARS,
  HUNKS_MAX_CHARS,
  OUTPUT_MAX_CHARS,
  REASONING_MAX_CHARS,
  capEditFiles,
  keepHead,
  keepTail,
  reasoningText,
  toolResultText,
  type EditFileInput
} from './common'

/**
 * 로그 길이 정책 (`docs/sdlc/conversation-events/` spec FR-10~12).
 * 상한은 어댑터가 이벤트를 만들 때 **한 번** 적용한다 — 그 한 자리가 여기다.
 */

const EMOJI = '\u{1F600}' // 서로게이트 쌍 — string.length가 2다

describe('상한 상수', () => {
  it('spec FR-10의 값이다', () => {
    expect(OUTPUT_MAX_CHARS).toBe(65_536)
    expect(REASONING_MAX_CHARS).toBe(65_536)
    expect(HUNKS_MAX_CHARS).toBe(131_072)
    expect(BEFORE_MAX_CHARS).toBe(131_072)
  })
})

describe('keepTail', () => {
  it('상한 이하면 그대로 두고 버린 것이 없다', () => {
    expect(keepTail('abc', 3)).toEqual({ text: 'abc', dropped: 0 })
  })

  it('끝부분을 남기고 버린 앞부분 글자 수를 센다', () => {
    expect(keepTail('abcdef', 4)).toEqual({ text: 'cdef', dropped: 2 })
  })

  it('자르는 자리가 서로게이트 쌍 가운데면 한 칸 옮겨 반쪽 글자를 남기지 않는다', () => {
    // 'a' + 😀(2칸) + 'b' — 끝 2칸이면 😀의 아래 반쪽부터가 된다
    const out = keepTail(`a${EMOJI}b`, 2)
    expect(out).toEqual({ text: 'b', dropped: 3 })
  })

  it('쌍 전체가 들어가면 그대로 남긴다', () => {
    expect(keepTail(`a${EMOJI}b`, 3)).toEqual({ text: `${EMOJI}b`, dropped: 1 })
  })
})

describe('keepHead', () => {
  it('상한 이하면 그대로 두고 버린 것이 없다', () => {
    expect(keepHead('abc', 5)).toEqual({ text: 'abc', dropped: 0 })
  })

  it('앞부분을 남기고 버린 뒷부분 글자 수를 센다', () => {
    expect(keepHead('abcdef', 4)).toEqual({ text: 'abcd', dropped: 2 })
  })

  it('자르는 자리가 서로게이트 쌍 가운데면 한 칸 당겨 반쪽 글자를 남기지 않는다', () => {
    expect(keepHead(`a${EMOJI}b`, 2)).toEqual({ text: 'a', dropped: 3 })
  })
})

describe('toolResultText — tool_result의 output', () => {
  it('끝부분 65,536자를 남기고 버린 앞부분을 outputTruncated로 적는다', () => {
    // 셸 출력은 끝(테스트 결과·오류)이 중요하다
    const text = `${'x'.repeat(70_000)}PASS`
    const out = toolResultText(text)
    expect(out.output).toHaveLength(OUTPUT_MAX_CHARS)
    expect(out.output?.endsWith('PASS')).toBe(true)
    expect(out.outputTruncated).toBe(text.length - OUTPUT_MAX_CHARS)
  })

  it('잘린 자리가 줄 가운데면 다음 줄바꿈까지 더 버린다 — 첫 줄이 글자 중간에서 시작하지 않는다', () => {
    // 리뷰 반영 2026-09-27: 캡처의 셸 출력 첫 줄이 'se139.test.ts (3 tests)'처럼 앞이 날아간 조각이었다
    const lines = Array.from({ length: 5_000 }, (_, i) => `✓ src/case${i}.test.ts (3 tests)`)
    const text = lines.join('\n')
    const out = toolResultText(text)
    const first = out.output!.split('\n')[0]!
    expect(lines).toContain(first)
    expect(out.output!.length).toBeLessThanOrEqual(OUTPUT_MAX_CHARS)
    // 버린 글자 수는 줄 조각까지 더한 정확한 수다
    expect(out.outputTruncated! + out.output!.length).toBe(text.length)
  })

  it('남긴 끝부분에 줄바꿈이 없으면(한 줄짜리 긴 출력) 그대로 둔다', () => {
    const text = 'y'.repeat(70_000)
    const out = toolResultText(text)
    expect(out.output).toHaveLength(OUTPUT_MAX_CHARS)
    expect(out.outputTruncated).toBe(text.length - OUTPUT_MAX_CHARS)
  })

  it('상한 이하면 outputTruncated 키 자체가 없다', () => {
    // 값이 있을 때만 싣는다(FR-7) — 0으로 채우지 않는다
    const out = toolResultText('ok')
    expect(out).toEqual({ output: 'ok' })
    expect('outputTruncated' in out).toBe(false)
  })

  it('비었거나 없으면 output도 싣지 않는다', () => {
    expect(toolResultText('')).toEqual({})
    expect(toolResultText(null)).toEqual({})
  })
})

describe('reasoningText — 생각 본문', () => {
  it('앞부분 65,536자를 남기고 버린 뒷부분을 truncated로 적는다', () => {
    // 생각은 읽는 순서대로다 — 셸 출력과 반대쪽을 남긴다
    const text = `START${'y'.repeat(70_000)}`
    const out = reasoningText(text)
    expect(out.text).toHaveLength(REASONING_MAX_CHARS)
    expect(out.text.startsWith('START')).toBe(true)
    expect(out.truncated).toBe(text.length - REASONING_MAX_CHARS)
  })

  it('상한 이하면 truncated 키 자체가 없다', () => {
    const out = reasoningText('음...')
    expect(out).toEqual({ text: '음...' })
    expect('truncated' in out).toBe(false)
  })

  it('공백뿐인 본문은 빈 문자열로 접는다', () => {
    // 화면이 "펼칠 것 없음"을 text === ''  하나로 판정한다
    expect(reasoningText('  \n\t ')).toEqual({ text: '' })
  })
})

function file(over: Partial<EditFileInput> = {}): EditFileInput {
  return {
    path: '/repo/a.ts',
    operation: 'edit',
    hunks: [],
    added: null,
    removed: null,
    before: null,
    beforeMissing: null,
    ...over
  }
}

const hunk = (lines: string[], oldStart = 1, newStart = 1) => ({
  oldStart, oldLines: lines.length, newStart, newLines: lines.length, lines
})

describe('capEditFiles — hunk 예산과 before 상한', () => {
  it('예산 안이면 그대로이고 hunksTruncated는 0이다', () => {
    const out = capEditFiles([file({ hunks: [hunk([' a', '-b', '+c'])] })])
    expect(out[0]).toMatchObject({ hunks: [hunk([' a', '-b', '+c'])], hunksTruncated: 0 })
  })

  it('예산은 파일을 넘어 이어지고, 넘치는 줄부터 뒤는 전부 버린다', () => {
    const out = capEditFiles([
      file({ path: '/a', hunks: [hunk(['+abc', '-de'])] }), // 4 + 3 = 7
      file({ path: '/b', hunks: [hunk([' x', '+yy', '-zzz']), hunk(['+q'], 20, 20)] }), // 2 → 9, 다음 3은 넘친다
      file({ path: '/c', hunks: [hunk(['+'])] }) // 1칸 — 예산에는 들어가지만 앞에서 이미 넘쳤다
    ], 10)
    expect(out.map((f) => f.path)).toEqual(['/a', '/b', '/c'])
    expect(out[0]).toMatchObject({ hunks: [hunk(['+abc', '-de'])], hunksTruncated: 0 })
    // 잘린 hunk는 머리를 그대로 두고 줄만 줄어든다. 줄이 하나도 안 남은 hunk는 빠진다
    expect(out[1]!.hunks).toEqual([{ ...hunk([' x', '+yy', '-zzz']), lines: [' x'] }])
    expect(out[1]!.hunksTruncated).toBe(3)
    // 예산이 다 떨어진 뒤의 짧은 줄도 들이지 않는다 — 앞쪽 줄만 남긴다
    expect(out[2]).toMatchObject({ hunks: [], hunksTruncated: 1 })
  })

  it('added·removed는 자르기 전에 센다', () => {
    // 화면의 +N −M이 잘린 값이 되면 안 된다(FR-12)
    const out = capEditFiles([
      file({ hunks: [hunk(['+1', '+2', '-3', ' 4', '+5'])] })
    ], 3)
    expect(out[0]).toMatchObject({ added: 3, removed: 1, hunksTruncated: 4 })
  })

  it('CLI가 준 added·removed는 그대로 둔다', () => {
    // opencode는 filediff.additions·deletions를 준다
    const out = capEditFiles([file({ hunks: [hunk(['+1'])], added: 40, removed: 7 })])
    expect(out[0]).toMatchObject({ added: 40, removed: 7 })
  })

  it('hunk가 없으면 added·removed를 지어내지 않는다', () => {
    // claude Write create — 내용은 tool_use.input에 있다. 0으로 채우면 "+0"이라는 거짓말이 된다
    const out = capEditFiles([file({ operation: 'create' })])
    expect(out[0]).toMatchObject({ added: null, removed: null, hunksTruncated: 0 })
  })

  it('before가 상한을 넘으면 싣지 않고 too_large로 적는다', () => {
    // 잘린 원본은 원본이 아니다
    const big = 'z'.repeat(BEFORE_MAX_CHARS + 1)
    const out = capEditFiles([file({ operation: 'overwrite', before: big })])
    expect(out[0]).toMatchObject({ before: null, beforeMissing: 'too_large' })
  })

  it('before가 상한 이하면 그대로 싣는다', () => {
    const exact = 'z'.repeat(BEFORE_MAX_CHARS)
    const out = capEditFiles([file({ operation: 'overwrite', before: exact })])
    expect(out[0]).toMatchObject({ before: exact, beforeMissing: null })
  })

  it('결과는 EditFileDetail 모양 그대로다', () => {
    const out: EditFileDetail[] = capEditFiles([file()])
    expect(Object.keys(out[0]!).sort()).toEqual([
      'added', 'before', 'beforeMissing', 'hunks', 'hunksTruncated', 'operation', 'path', 'removed'
    ])
  })
})
