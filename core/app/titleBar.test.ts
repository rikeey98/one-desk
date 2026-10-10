import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TITLEBAR_COLORS, TITLEBAR_HEIGHT } from '@shared/titleBar'

// main은 CSS를 읽을 수 없어 OS 창 단추의 색을 상수로 받는다 — 그 상수가 렌더러 토큰과 같은지 여기서 본다.
// 어긋나면 제목 줄 오른쪽 끝에 OS 단추만 다른 색 띠로 보인다(다크에서 특히).
// shared/에 두지 않은 이유: shared/는 렌더러 타입 검사(tsconfig.web.json)에도 걸려 node 모듈을 import할 수 없다(CLAUDE.md).
const css = readFileSync(join(__dirname, '../../renderer/index.css'), 'utf8')
const darkStart = css.indexOf('@media (prefers-color-scheme: dark)')

function token(name: string, scheme: 'light' | 'dark'): string | undefined {
  const block = scheme === 'light' ? css.slice(0, darkStart) : css.slice(darkStart)
  return new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block)?.[1]?.toLowerCase()
}

describe('제목 줄 (docs/sdlc/code-editor/ FR-1, 2026-10-10)', () => {
  it.each(['light', 'dark'] as const)('%s: OS 창 단추의 바탕은 --bg-canvas, 기호는 --text-secondary다', (scheme) => {
    expect(TITLEBAR_COLORS[scheme].color).toBe(token('bg-canvas', scheme))
    expect(TITLEBAR_COLORS[scheme].symbolColor).toBe(token('text-secondary', scheme))
  })

  it('CSS가 OS 정보를 못 받을 때의 높이가 main이 OS 단추에 준 높이와 같다', () => {
    expect(css).toContain(`env(titlebar-area-height, ${TITLEBAR_HEIGHT}px)`)
  })
})
