// 렌더러 타입 검사에는 node 모듈이 없다 — Vite의 ?raw로 글자 그대로 가져온다
import RAW_CSS from './index.css?raw'

/**
 * `index.css`를 글자로 읽어 토큰과 선언을 재는 테스트 도구. jsdom은 CSS를 계산하지 않으므로 색·모양의
 * 규칙은 이것으로 본다.
 */

export const CSS = RAW_CSS.replace(/\/\*[\s\S]*?\*\//g, '')

export type Rgba = [number, number, number, number]

/** `:root { … }` 블록의 토큰. 다크는 `prefers-color-scheme: dark` 안의 것이 라이트 위에 덮인다 */
export function tokens(): { light: Map<string, string>; dark: Map<string, string> } {
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
export function declared(selector: string, property: string): string | null {
  let value: string | null = null
  for (const m of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1]!.split(',').map((part: string) => part.trim())
    if (!selectors.includes(selector)) continue
    const decl = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`).exec(m[2]!)
    if (decl) value = decl[1]!.trim()
  }
  return value
}

export function resolveColor(value: string, map: Map<string, string>): Rgba {
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

export function over(top: Rgba, bottom: Rgba): Rgba {
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

export function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}
