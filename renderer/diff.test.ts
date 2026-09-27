import { describe, it, expect } from 'vitest'
import { lineDiff, diffStats, truncateHunks, MAX_DIFF_CELLS } from './diff'

const signs = (hunk: ReturnType<typeof lineDiff>) =>
  hunk.lines.map((l) => `${l.sign}${l.text}`)

describe('lineDiff', () => {
  it('한 줄을 바꾸면 지운 줄 다음에 더한 줄이 온다', () => {
    expect(signs(lineDiff('a < b', 'a <= b'))).toEqual(['-a < b', '+a <= b'])
  })

  it('앞뒤 공통 줄은 문맥으로 남는다', () => {
    const before = 'import x\nif (a < b) {\n  go()\n}'
    const after = 'import x\nif (a <= b) {\n  go()\n}'
    expect(signs(lineDiff(before, after))).toEqual([
      ' import x', '-if (a < b) {', '+if (a <= b) {', '   go()', ' }'
    ])
  })

  it('가운데에 끼운 줄만 더한 줄이 된다', () => {
    expect(signs(lineDiff('a\nc', 'a\nb\nc'))).toEqual([' a', '+b', ' c'])
  })

  it('빈 before는 전부 추가다 — Write가 이 모양이다', () => {
    expect(signs(lineDiff('', 'one\ntwo'))).toEqual(['+one', '+two'])
  })

  it('끝의 줄바꿈 하나는 빈 줄로 세지 않는다', () => {
    expect(signs(lineDiff('', 'one\ntwo\n'))).toEqual(['+one', '+two'])
  })

  it('CRLF도 줄로 가른다', () => {
    expect(signs(lineDiff('a\r\nb', 'a\r\nc'))).toEqual([' a', '-b', '+c'])
  })

  it('둘 다 비면 줄이 없다', () => {
    expect(lineDiff('', '').lines).toEqual([])
  })

  it('가운데 두 쪽 줄 수의 곱이 상한을 넘으면 전부 지우고 전부 추가한다', () => {
    // 렌더러의 한 프레임을 diff 계산이 먹으면 안 된다 (spec FR-7).
    const n = Math.floor(Math.sqrt(MAX_DIFF_CELLS)) + 1
    const before = Array.from({ length: n }, (_, i) => `old ${i}`).join('\n')
    // 공통 줄 하나를 가운데 끼워 둔다 — LCS였다면 문맥으로 남았을 줄이다.
    const after = Array.from({ length: n }, (_, i) => (i === 5 ? 'old 5' : `new ${i}`)).join('\n')
    const { lines } = lineDiff(`head\n${before}\ntail`, `head\n${after}\ntail`)
    expect(lines[0]).toEqual({ sign: ' ', text: 'head' })
    expect(lines.at(-1)).toEqual({ sign: ' ', text: 'tail' })
    const middle = lines.slice(1, -1)
    expect(middle.filter((l) => l.sign === ' ')).toHaveLength(0)
    expect(middle.slice(0, n).every((l) => l.sign === '-')).toBe(true)
    expect(middle.slice(n).every((l) => l.sign === '+')).toBe(true)
  })

  it('상한 안이면 LCS가 공통 줄을 찾는다', () => {
    expect(signs(lineDiff('x\nkeep\ny', 'p\nkeep\nq'))).toEqual([
      '-x', '+p', ' keep', '-y', '+q'
    ])
  })
})

describe('diffStats', () => {
  it('여러 hunk의 더한 줄과 지운 줄을 센다 — 문맥은 세지 않는다', () => {
    expect(diffStats([lineDiff('a\nb', 'a\nc'), lineDiff('', 'x\ny')]))
      .toEqual({ added: 3, removed: 1 })
  })

  it('hunk가 없으면 0이다', () => {
    expect(diffStats([])).toEqual({ added: 0, removed: 0 })
  })
})

describe('truncateHunks', () => {
  const big = lineDiff('', Array.from({ length: 450 }, (_, i) => `line ${i}`).join('\n'))

  it('400줄까지만 남기고 나머지 줄 수를 돌려준다', () => {
    const { hunks, truncated } = truncateHunks([big])
    expect(hunks.flatMap((h) => h.lines)).toHaveLength(400)
    expect(truncated).toBe(50)
  })

  it('+N −M은 자르기 전 diff에서 센다', () => {
    // 잘린 뒤의 수를 세면 "+400"이 되어 450줄을 쓴 것이 거짓말이 된다.
    expect(diffStats([big]).added).toBe(450)
    expect(diffStats(truncateHunks([big]).hunks).added).toBe(400)
  })

  it('hunk 경계를 넘어 자른다 — 남는 hunk만 남긴다', () => {
    const a = lineDiff('', Array.from({ length: 300 }, (_, i) => `a${i}`).join('\n'))
    const b = lineDiff('', Array.from({ length: 300 }, (_, i) => `b${i}`).join('\n'))
    const c = lineDiff('', 'c')
    const { hunks, truncated } = truncateHunks([a, b, c])
    expect(hunks).toHaveLength(2)
    expect(hunks[0]!.lines).toHaveLength(300)
    expect(hunks[1]!.lines).toHaveLength(100)
    expect(truncated).toBe(201)
  })

  it('상한 안이면 그대로다', () => {
    const small = lineDiff('a', 'b')
    expect(truncateHunks([small])).toEqual({ hunks: [small], truncated: 0 })
  })
})
