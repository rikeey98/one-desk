import { describe, it, expect } from 'vitest'
// 렌더러 타입 검사에는 node 모듈이 없다 — Vite의 ?raw로 글자 그대로 가져온다
import RAW_CSS from './index.css?raw'

/**
 * 줄 번호 diff의 번호 칸 글자 대비 (`docs/sdlc/conversation-events/` spec FR-47, DESIGN.md의 4.5:1).
 *
 * 리뷰 반영 2026-09-27: 번호 칸은 `--text-muted`인데, 다크 스킴에서 추가 줄의 초록 바탕
 * (`--success-bg`, 반투명)이 `--bg-muted` 위에 겹치면 대비가 약 3.75:1로 떨어졌다. 캡처는 문맥 줄
 * 위의 번호만 쟀기 때문에 통과한 것처럼 보였다. jsdom은 CSS를 계산하지 않으므로 **토큰 값과 규칙을
 * `index.css`에서 직접 읽어** 줄 종류(문맥·추가·삭제)마다, 두 스킴 모두에서 잰다.
 */

const CSS = RAW_CSS.replace(/\/\*[\s\S]*?\*\//g, '')

type Rgba = [number, number, number, number]

/** `:root { … }` 블록의 토큰. 다크는 `prefers-color-scheme: dark` 안의 것이 라이트 위에 덮인다 */
function tokens(): { light: Map<string, string>; dark: Map<string, string> } {
  const read = (block: string) => new Map(
    [...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()] as [string, string])
  )
  const light = /^:root\s*\{([^}]*)\}/m.exec(CSS)
  const dark = /@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(CSS)
  if (!light || !dark) throw new Error('index.css에서 :root 블록을 찾지 못했다')
  const lightMap = read(light[1]!)
  return { light: lightMap, dark: new Map([...lightMap, ...read(dark[1]!)]) }
}

/** 선택자 하나가 받는 선언 값 — 선택자 목록에 정확히 그 선택자가 든 규칙 중 마지막 것 */
function declared(selector: string, property: string): string | null {
  let value: string | null = null
  for (const m of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1]!.split(',').map((part: string) => part.trim())
    if (!selectors.includes(selector)) continue
    const decl = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`).exec(m[2]!)
    if (decl) value = decl[1]!.trim()
  }
  return value
}

function resolveColor(value: string, map: Map<string, string>): Rgba {
  const v = /^var\((--[\w-]+)\)$/.exec(value)
  if (v) return resolveColor(map.get(v[1]!) ?? '', map)
  const hex = /^#([0-9a-f]{6})$/i.exec(value)
  if (hex) {
    const n = parseInt(hex[1]!, 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1]
  }
  const rgba = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/.exec(value)
  if (rgba) return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), Number(rgba[4])]
  throw new Error(`색을 읽지 못했다: ${value}`)
}

function over(top: Rgba, bottom: Rgba): Rgba {
  const a = top[3]
  return [0, 1, 2].map((i) => top[i]! * a + bottom[i]! * (1 - a)).concat(1) as Rgba
}

function luminance([r, g, b]: Rgba): number {
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

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
