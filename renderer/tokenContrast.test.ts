import { describe, it, expect } from 'vitest'
import { CSS, contrast, declared, resolveColor, tokens } from './cssTokens.testkit'

/**
 * 키보드·저시력 사용자가 기대는 색과 모양 (WCAG 1.4.1·1.4.3·1.4.11). 컴포넌트 테스트는 CSS를 계산하지 못하므로
 * 토큰 값을 `index.css`에서 직접 읽어 두 스킴 모두에서 잰다.
 */

const { light, dark } = tokens()
const SCHEMES = [['라이트', light], ['다크', dark]] as const
const SURFACES = ['--bg', '--bg-canvas', '--bg-panel', '--bg-muted']

function ratio(foreground: string, background: string, map: Map<string, string>): number {
  return contrast(resolveColor(foreground, map), resolveColor(background, map))
}

describe('포커스 표시', () => {
  for (const [scheme, map] of SCHEMES) {
    for (const surface of SURFACES) {
      it(`${scheme} · 포커스 링이 ${surface} 위에서 3:1을 넘는다`, () => {
        expect(ratio('var(--focus-ring)', `var(${surface})`, map)).toBeGreaterThanOrEqual(3)
      })
    }
  }

  it('입력 카드의 포커스 테두리는 포커스 링 토큰이다 — 입력칸 자신은 윤곽선을 끈다', () => {
    expect(declared('.composer-card:focus-within', 'border-color')).toBe('var(--focus-ring)')
  })

  it('입력칸의 기본 포커스 링을 지우는 규칙은 입력 카드의 입력칸뿐이다', () => {
    expect(declared('.add-repo-form input:focus', 'outline')).toBeNull()
    expect(declared('.window-splitter:focus-visible', 'outline')).toBeNull()
  })
})

describe('입력 칸의 경계', () => {
  for (const [scheme, map] of SCHEMES) {
    for (const surface of SURFACES) {
      it(`${scheme} · 입력 경계가 ${surface} 위에서 3:1을 넘는다`, () => {
        expect(ratio('var(--border-control)', `var(${surface})`, map)).toBeGreaterThanOrEqual(3)
      })
    }
  }

  it.each([
    '.add-form :is(input, textarea)', '.add-repo-form input', '.pill, .composer-controls .settings-field', '.detail-status', '.detail-axis select',
    '.detail-body', '.issue-picker-input', '.group-axis select', '.settings-field :is(input, select, textarea)',
    '.asset-add select', '.report-dates input', '.code-tree-filter', '.dock-slots-input', '.composer-card'
  ])('%s 는 입력 경계 토큰을 쓴다', (selector) => {
    expect(CSS.slice(CSS.indexOf(`\n${selector} {`)).split('}')[0]).toContain('border: 1px solid var(--border-control)')
  })
})

describe('글자 대비', () => {
  for (const [scheme, map] of SCHEMES) {
    for (const surface of SURFACES) {
      it(`${scheme} · placeholder가 ${surface} 위에서 4.5:1을 넘는다`, () => {
        expect(ratio(declared('::placeholder', 'color') ?? '', `var(${surface})`, map)).toBeGreaterThanOrEqual(4.5)
      })
    }

    it(`${scheme} · 경고 배지의 글자가 4.5:1을 넘는다`, () => {
      expect(ratio(declared('.badge-error', 'color') ?? '', 'var(--warn)', map)).toBeGreaterThanOrEqual(4.5)
      expect(ratio(declared('.home-link .badge', 'color') ?? '', 'var(--warn)', map)).toBeGreaterThanOrEqual(4.5)
    })

    it(`${scheme} · 호버한 대화 줄의 메타가 4.5:1을 넘는다`, () => {
      const color = declared('.dock-conv:hover .dock-conv-meta', 'color') ?? ''
      expect(ratio(color, 'var(--bg-hover)', map)).toBeGreaterThanOrEqual(4.5)
    })

    it(`${scheme} · 실행 중 고리가 호버한 줄 위에서도 3:1을 넘는다`, () => {
      expect(ratio('var(--status-running)', 'var(--bg-hover)', map)).toBeGreaterThanOrEqual(3)
    })
  }
})

describe('상태 점은 색이 아니라 모양으로도 갈린다', () => {
  const shapeOf = (selector: string) => ['background', 'border-radius', 'box-shadow', 'clip-path', 'height', 'transform']
    .map((property) => {
      const value = declared(selector, property)
      return property === 'background' && value !== 'none' ? 'filled' : value
    })
    .join('|')

  it('상태마다 모양이 다르다', () => {
    const shapes = [
      '.status-dot.status-running', '.status-dot.status-succeeded', '.status-dot.status-failed',
      '.status-dot.status-canceled', '.status-dot.status-pending', '.status-dot.status-needs-answer'
    ].map(shapeOf)
    expect(new Set(shapes).size).toBe(shapes.length)
  })

  it('중단은 실패와 같은 모양이다 — 같은 뜻이고 색도 같다', () => {
    expect(shapeOf('.status-dot.status-interrupted')).toBe(shapeOf('.status-dot.status-failed'))
  })

  it('MCP 실패는 연결된 점과 모양이 다르다', () => {
    expect(declared('.mcp-status-failed .mcp-dot', 'transform')).toContain('rotate')
  })
})

describe('펼침 꺾쇠', () => {
  it.each(['.group-chevron', '.code-tree-chevron', '.inbox-order svg'])('%s 는 돌아가 있을 뿐 움직이지 않는다', (selector) => {
    expect(declared(selector, 'transition')).toBeNull()
  })
})
