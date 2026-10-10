import { useEffect, useRef } from 'react'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import {
  EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, keymap, lineNumbers
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { bracketMatching, indentOnInput } from '@codemirror/language'
import { editorTheme } from './editorTheme'
import { loadLanguage } from './languages'
import type { LanguageName } from '../../code/language'

/** 처음 갈 줄. `nonce`가 바뀔 때마다 간다 — 같은 줄을 다시 눌러도 그 자리로 돌아간다 */
export interface GotoLine {
  line: number
  nonce: number
}

/**
 * CodeMirror 6을 감싸는 얇은 컴포넌트 (docs/sdlc/code-editor/ FR-12). **판정을 여기 두지 않는다** — jsdom에서
 * CodeMirror를 믿을 수 없어(측정이 없다) 이것은 e2e만 본다(plan 위험 2). 고친 것인지·저장할 것인지는 스토어와
 * `FilePane`이 정하고, 여기는 글을 보이고 바뀐 글과 Mod-s를 알릴 뿐이다.
 *
 * - `docKey`가 바뀌면 상태를 새로 만든다(실행 취소 기록도 새로 — 다른 파일의 실행 취소가 넘어오면 안 된다).
 * - 같은 `docKey`에 바깥 `text`가 편집기 글과 다르면(디스크 다시 읽기·고친 것 버리기) 통째로 바꾸되 커서 줄을 지킨다.
 */
export function CodeEditor({ docKey, text, readOnly, language, gotoLine, label, onChange, onSave }: {
  docKey: string
  text: string
  readOnly: boolean
  language: LanguageName | null
  gotoLine: GotoLine | null
  /** 편집 영역의 접근성 이름 */
  label: string
  onChange: (text: string) => void
  onSave: () => void
}) {
  const host = useRef<HTMLDivElement | null>(null)
  const view = useRef<EditorView | null>(null)
  const readOnlyCompartment = useRef(new Compartment())
  const languageCompartment = useRef(new Compartment())
  const labelCompartment = useRef(new Compartment())
  // 콜백은 늘 최신을 부른다 — 확장은 상태를 만들 때 한 번 고정된다.
  const latest = useRef({ onChange, onSave })
  latest.current = { onChange, onSave }
  const currentKey = useRef<string | null>(null)

  function readOnlyExtension(value: boolean): Extension {
    return [EditorState.readOnly.of(value), EditorView.editable.of(!value)]
  }

  function makeState(doc: string): EditorState {
    return EditorState.create({
      doc,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        keymap.of([
          // Mod-s는 맨 앞 — 브라우저의 "페이지 저장"이 뜨지 않게 처리했다고 알린다(true → preventDefault)
          { key: 'Mod-s', run: () => { latest.current.onSave(); return true } },
          ...searchKeymap,
          ...historyKeymap,
          indentWithTab,
          ...defaultKeymap
        ]),
        editorTheme,
        readOnlyCompartment.current.of(readOnlyExtension(readOnly)),
        languageCompartment.current.of([]),
        labelCompartment.current.of(EditorView.contentAttributes.of({ 'aria-label': label })),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) latest.current.onChange(update.state.doc.toString())
        })
      ]
    })
  }

  // 만들고 치우기 — 한 번
  useEffect(() => {
    if (!host.current) return
    const created = new EditorView({ parent: host.current, state: makeState(text) })
    view.current = created
    currentKey.current = docKey
    return () => {
      created.destroy()
      view.current = null
      currentKey.current = null
    }
    // 처음 한 번만 만든다 — 이후의 글·키 변화는 아래 effect들이 다룬다
  }, [])

  // 문서 — 다른 파일이면 새 상태, 같은 파일인데 바깥 글이 다르면 통째로 바꾸되 커서 줄을 지킨다
  useEffect(() => {
    const v = view.current
    if (!v) return
    if (currentKey.current !== docKey) {
      currentKey.current = docKey
      v.setState(makeState(text))
      return
    }
    const doc = v.state.doc
    if (doc.toString() === text) return
    const lineNo = doc.lineAt(v.state.selection.main.head).number
    v.dispatch({ changes: { from: 0, to: doc.length, insert: text } })
    const kept = v.state.doc.line(Math.min(lineNo, v.state.doc.lines))
    v.dispatch({ selection: { anchor: kept.from } })
    // makeState는 렌더마다 새로 만드는 지역 함수라 의존성에 두지 않는다 — 두면 매 렌더 문서를 다시 세운다
  }, [docKey, text])

  useEffect(() => {
    view.current?.dispatch({ effects: readOnlyCompartment.current.reconfigure(readOnlyExtension(readOnly)) })
  }, [readOnly, docKey])

  useEffect(() => {
    view.current?.dispatch({
      effects: labelCompartment.current.reconfigure(EditorView.contentAttributes.of({ 'aria-label': label }))
    })
  }, [label, docKey])

  // 언어 — 조각을 받는 사이 다른 파일로 바뀌었으면 늦게 온 것을 버린다
  useEffect(() => {
    const v = view.current
    if (!v) return
    if (language === null) {
      v.dispatch({ effects: languageCompartment.current.reconfigure([]) })
      return
    }
    let stale = false
    void loadLanguage(language).then((extension) => {
      if (stale || view.current !== v) return
      v.dispatch({ effects: languageCompartment.current.reconfigure(extension) })
    }).catch(() => { /* 강조만 못 할 뿐이다 — 평문으로 남는다 */ })
    return () => { stale = true }
  }, [language, docKey])

  // 처음 갈 줄 (FR-23)
  useEffect(() => {
    const v = view.current
    if (!v || !gotoLine) return
    const line = v.state.doc.line(Math.max(1, Math.min(gotoLine.line, v.state.doc.lines)))
    v.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'center' }) })
  }, [gotoLine, docKey])

  return <div className="code-editor" ref={host} />
}
