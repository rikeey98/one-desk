import type { Extension } from '@codemirror/state'
import type { LanguageName } from '../../code/language'

/**
 * 언어 패키지 불러오기 (docs/sdlc/code-editor/ FR-12). **전부 동적 `import()`다** — 첫 번들에 넣지 않고 그 확장자의
 * 파일을 처음 열 때 조각을 받는다. 이름 → 패키지 표는 `code/language.ts`가 정하고 여기는 불러오기만 한다.
 */
const LOADERS: Record<LanguageName, () => Promise<Extension>> = {
  javascript: () => import('@codemirror/lang-javascript').then((m) => m.javascript()),
  jsx: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ jsx: true })),
  typescript: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ typescript: true })),
  tsx: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ jsx: true, typescript: true })),
  json: () => import('@codemirror/lang-json').then((m) => m.json()),
  css: () => import('@codemirror/lang-css').then((m) => m.css()),
  html: () => import('@codemirror/lang-html').then((m) => m.html()),
  markdown: () => import('@codemirror/lang-markdown').then((m) => m.markdown()),
  python: () => import('@codemirror/lang-python').then((m) => m.python()),
  yaml: () => import('@codemirror/lang-yaml').then((m) => m.yaml())
}

export function loadLanguage(name: LanguageName): Promise<Extension> {
  return LOADERS[name]()
}
