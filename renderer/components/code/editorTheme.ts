import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import type { Extension } from '@codemirror/state'

/**
 * 코드 칸 편집기의 모양 (docs/sdlc/code-editor/ FR-13). **색은 전부 `var(--…)`다** — `renderer/index.css`의 토큰이
 * 다크 스킴에서 값만 바꾸므로 편집기도 따라간다. 여기에 hex를 쓰면 그 자리만 다크에서 흰 채로 남는다(CLAUDE.md).
 */
const base = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--text)',
    backgroundColor: 'var(--bg)',
    fontSize: '0.75rem'
  },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.55' },
  '.cm-content': { caretColor: 'var(--text)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--text)' },
  '&.cm-focused': { outline: 'none' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--accent-bg-strong)'
  },
  '.cm-activeLine': { backgroundColor: 'var(--bg-muted)' },
  '.cm-gutters': {
    backgroundColor: 'var(--bg-panel)',
    color: 'var(--text-muted)',
    borderRight: '1px solid var(--border-faint)'
  },
  '.cm-activeLineGutter': { backgroundColor: 'var(--bg-muted)', color: 'var(--text-secondary)' },
  '&.cm-focused .cm-matchingBracket': { backgroundColor: 'var(--accent-bg)', outline: '1px solid var(--accent-border-soft)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--accent-bg)' },
  '.cm-searchMatch': { backgroundColor: 'var(--warn-bg)', outline: '1px solid var(--warn-bg-strong)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--warn-bg-strong)' },
  // 찾기 창 — 앱의 입력칸·버튼과 같은 토큰을 쓴다
  '.cm-panels': { backgroundColor: 'var(--bg-panel)', color: 'var(--text)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--border)' },
  '.cm-panel.cm-search': { fontFamily: 'inherit', fontSize: '0.75rem', padding: '4px 8px' },
  '.cm-panel.cm-search input, .cm-panel.cm-search button, .cm-panel.cm-search label': { fontSize: '0.75rem' },
  '.cm-textfield': {
    backgroundColor: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border-strong)', borderRadius: '4px'
  },
  '.cm-button': {
    backgroundImage: 'none', backgroundColor: 'var(--bg)', color: 'var(--text)',
    border: '1px solid var(--border-strong)', borderRadius: '4px'
  },
  '.cm-panel button[name=close]': { color: 'var(--text-muted)' }
})

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.operatorKeyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword], color: 'var(--code-keyword)' },
  { tag: [t.string, t.special(t.string), t.regexp, t.character], color: 'var(--code-string)' },
  // 기울이지 않는다 — 한글 주석은 이탤릭 글꼴이 없어 가짜로 기울어져 읽기 어렵다(캡처에서 봤다)
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: 'var(--code-comment)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--code-number)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: 'var(--code-function)' },
  { tag: [t.typeName, t.className, t.namespace, t.definition(t.typeName)], color: 'var(--code-type)' },
  { tag: [t.tagName, t.angleBracket], color: 'var(--code-tag)' },
  { tag: [t.propertyName, t.attributeName], color: 'var(--code-property)' },
  { tag: t.heading, color: 'var(--code-keyword)', fontWeight: '700' },
  { tag: [t.link, t.url], color: 'var(--code-function)', textDecoration: 'underline' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.invalid, color: 'var(--danger)' }
])

export const editorTheme: Extension = [base, syntaxHighlighting(highlight)]
