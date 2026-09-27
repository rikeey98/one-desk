import { describe, it, expect } from 'vitest'
import { lineDiff, diffStats, truncateHunks, hunksFromPatch, MAX_DIFF_CELLS, type DiffHunk } from './diff'

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

  it('잘린 hunk도 머리(시작 번호·간격)를 지킨다 — 번호 칸과 구분선이 그것을 본다', () => {
    const numbered = hunksFromPatch([{
      oldStart: 41, oldLines: 450, newStart: 41, newLines: 450,
      lines: Array.from({ length: 450 }, (_, i) => ` line ${i}`)
    }])
    const [hunk] = truncateHunks(numbered).hunks
    expect(hunk).toMatchObject({ oldStart: 41, newStart: 41, gapBefore: 40 })
    expect(hunk!.lines).toHaveLength(400)
  })
})

/** detail의 hunk에서 줄 번호 diff를 만든다 (`docs/sdlc/conversation-events/` spec FR-37) */
describe('hunksFromPatch', () => {
  const view = (hunk: DiffHunk) =>
    hunk.lines.map((l) => `${l.oldNo ?? '.'} ${l.newNo ?? '.'} ${l.sign}${l.text}`)

  it('문맥은 두 번호를, 지운 줄은 옛 번호만, 더한 줄은 새 번호만 센다', () => {
    const [hunk] = hunksFromPatch([{
      oldStart: 41, oldLines: 4, newStart: 41, newLines: 5,
      lines: [' const a = 1', '-if (a < b) {', '+if (a <= b) {', '+  log()', ' }', ' ']
    }])
    expect(view(hunk!)).toEqual([
      '41 41  const a = 1',
      '42 . -if (a < b) {',
      '. 42 +if (a <= b) {',
      '. 43 +  log()',
      '43 44  }',
      '44 45  '
    ])
    expect(hunk).toMatchObject({ oldStart: 41, newStart: 41 })
  })

  it('첫 hunk의 간격은 그 위의 줄 수이고, 그다음은 앞 hunk 끝부터다', () => {
    const hunks = hunksFromPatch([
      { oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, lines: [' a', ' b'] },
      { oldStart: 10, oldLines: 3, newStart: 10, newLines: 4, lines: [' x', '+y', ' z', ' w'] },
      { oldStart: 13, oldLines: 1, newStart: 14, newLines: 1, lines: [' q'] }
    ])
    // 앞 hunk가 1~2줄 → 3~9줄(7줄)을 건너뛰고 10줄, 10~12줄 바로 뒤 13줄은 간격이 없다
    expect(hunks.map((h) => h.gapBefore)).toEqual([0, 7, 0])
    expect(hunksFromPatch([
      { oldStart: 41, oldLines: 1, newStart: 41, newLines: 1, lines: [' a'] }
    ])[0]!.gapBefore).toBe(40)
  })

  it('간격은 음수가 되지 않는다 — 새 파일의 `-0,0`이나 순서가 어긋난 hunk', () => {
    expect(hunksFromPatch([
      { oldStart: 0, oldLines: 0, newStart: 1, newLines: 1, lines: ['+new'] }
    ])[0]!.gapBefore).toBe(0)
    expect(hunksFromPatch([
      { oldStart: 20, oldLines: 5, newStart: 20, newLines: 5, lines: [' a'] },
      { oldStart: 3, oldLines: 1, newStart: 3, newLines: 1, lines: [' b'] }
    ])[1]!.gapBefore).toBe(0)
  })

  it('부호가 아닌 줄은 줄로 세지 않는다 — `\\ No newline`이 번호를 밀면 안 된다', () => {
    const [hunk] = hunksFromPatch([{
      oldStart: 5, oldLines: 1, newStart: 5, newLines: 1,
      lines: ['-old', '\\ No newline at end of file', '+new']
    }])
    expect(view(hunk!)).toEqual(['5 . -old', '. 5 +new'])
  })

  it('줄이 하나도 없는 hunk는 빠지고, 간격은 보인 hunk부터 잰다 — 안 보인 줄을 빼먹지 않는다', () => {
    const hunks = hunksFromPatch([
      { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: [' a'] },
      { oldStart: 3, oldLines: 2, newStart: 3, newLines: 2, lines: [] },
      { oldStart: 8, oldLines: 1, newStart: 8, newLines: 1, lines: [' k'] }
    ])
    expect(hunks).toHaveLength(2)
    // 2~7줄(6줄)이 화면에 없다 — 빈 hunk의 끝(5)부터 재면 "⋯ 3줄"이 되어 셋을 빼먹는다
    expect(hunks[1]!.gapBefore).toBe(6)
  })

  it('+N −M은 번호 diff에서도 같은 규칙으로 센다', () => {
    expect(diffStats(hunksFromPatch([
      { oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, lines: [' a', '-b', '+c'] }
    ]))).toEqual({ added: 1, removed: 1 })
  })
})
