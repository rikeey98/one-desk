/**
 * 확장자 → 구문 강조 언어 (docs/sdlc/code-editor/ spec FR-12). 이름만 정한다 — 언어 패키지를 불러오는 것은
 * `components/code/languages.ts`의 동적 `import()`다(첫 번들에 넣지 않는다). 모르는 확장자는 null(평문).
 */
export type LanguageName =
  | 'javascript' | 'jsx' | 'typescript' | 'tsx' | 'json' | 'css' | 'html' | 'markdown' | 'python' | 'yaml'

const BY_EXTENSION: Record<string, LanguageName> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx',
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'tsx',
  json: 'json', css: 'css', html: 'html', htm: 'html',
  md: 'markdown', markdown: 'markdown', py: 'python', yml: 'yaml', yaml: 'yaml'
}

export function languageOf(path: string): LanguageName | null {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  // 점이 없거나 맨 앞뿐이면(.gitignore) 확장자가 없다
  if (dot <= 0) return null
  return BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? null
}
