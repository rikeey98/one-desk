import { describe, it, expect } from 'vitest'
import { contrast, declared, over, resolveColor, tokens } from './cssTokens.testkit'

/**
 * 줄 번호 diff의 번호 칸 글자 대비 (`docs/sdlc/conversation-events/` spec FR-47, DESIGN.md의 4.5:1).
 *
 * 리뷰 반영 2026-09-27: 번호 칸은 `--text-muted`인데, 다크 스킴에서 추가 줄의 초록 바탕
 * (`--success-bg`, 반투명)이 `--bg-muted` 위에 겹치면 대비가 약 3.75:1로 떨어졌다. 캡처는 문맥 줄
 * 위의 번호만 쟀기 때문에 통과한 것처럼 보였다. jsdom은 CSS를 계산하지 않으므로 **토큰 값과 규칙을
 * `index.css`에서 직접 읽어** 줄 종류(문맥·추가·삭제)마다, 두 스킴 모두에서 잰다.
 */

describe('줄 번호 diff — 번호 칸의 글자 대비', () => {
  const { light, dark } = tokens()
  const rows = [
    { row: 'ctx', line: '.tl-ctx' },
    { row: 'add', line: '.tl-add' },
    { row: 'del', line: '.tl-del' }
  ]

  for (const [scheme, map] of [['라이트', light], ['다크', dark]] as const) {
    for (const { row, line } of rows) {
      it(`${scheme} · ${row} 줄 위의 번호가 4.5:1을 넘는다`, () => {
        const diffBg = resolveColor(declared('.tl-diff', 'background') ?? '', map)
        const lineBg = declared(line, 'background')
        const bg = lineBg === null ? diffBg : over(resolveColor(lineBg, map), diffBg)
        const color = declared(`${line} .tl-diff-no`, 'color') ?? declared('.tl-diff-no', 'color') ?? ''
        const ratio = contrast(resolveColor(color, map), bg)
        expect(ratio, `${color} on ${row}`).toBeGreaterThanOrEqual(4.5)
      })
    }
  }
})
