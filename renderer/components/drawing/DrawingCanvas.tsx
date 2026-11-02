// 이 import가 맨 앞이어야 한다 — Excalidraw가 불리기 전에 글꼴 주소를 세운다 (excalidrawSetup.ts, spec FR-29)
import './excalidrawSetup'
import '@excalidraw/excalidraw/index.css'
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import {
  CaptureUpdateAction, Excalidraw, MainMenu, reconcileElements, restoreElements
} from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { RemoteExcalidrawElement } from '@excalidraw/excalidraw/data/reconcile'
import { useClient } from '../../client/ClientProvider'
import { useDebouncedSave } from '../../hooks/useDebouncedSave'
import { useItemChanged } from '../../hooks/useItemChanged'
import { createDrawingSync, parseSceneElements, type SceneElement } from '../../drawing/sync'
import { blocksDrop, blocksPaste } from '../../drawing/guards'
import type { Drawing } from '@shared/models'

/**
 * 그림 하나의 캔버스 (docs/sdlc/drawings/ spec §8). **Excalidraw를 import하는 유일한 파일이고, 부르는 쪽은 `lazy`로 부른다**(FR-20) —
 * Excalidraw는 JS만 수 MB라 앱 시작 번들에 들면 안 된다. 코드 칸과 그림 창이 같은 컴포넌트를 쓴다.
 *
 * 판정(저장할 것이 있나 · 충돌 · 합치기 · 메아리 · 지워짐 · 막을 붙여넣기 · 끌어 놓기)은 전부 `renderer/drawing/`의 순수 함수다 — jsdom은
 * Excalidraw를 그리지 못한다. 여기는 Excalidraw에 잇기만 한다.
 */
export type SaveStatus = { kind: 'saving' } | { kind: 'saved' } | { kind: 'failed'; message: string }

function usePrefersDark(): boolean {
  const query = '(prefers-color-scheme: dark)'
  const [dark, setDark] = useState(() => window.matchMedia?.(query).matches ?? false)
  useEffect(() => {
    const scheme = window.matchMedia?.(query)
    if (!scheme) return
    const onChange = () => { setDark(scheme.matches) }
    scheme.addEventListener('change', onChange)
    return () => { scheme.removeEventListener('change', onChange) }
  }, [])
  return dark
}

export default function DrawingCanvas({ drawing, onStatus, onDeleted }: {
  /** 연 순간의 그림. 다른 그림을 열면 부르는 쪽이 key로 갈아끼운다 */
  drawing: Drawing
  onStatus: (status: SaveStatus) => void
  onDeleted: () => void
}) {
  const client = useClient()
  const api = useRef<ExcalidrawImperativeAPI | null>(null)
  const dark = usePrefersDark()
  const latest = useRef({ onStatus, onDeleted })
  latest.current = { onStatus, onDeleted }

  // 연 순간의 장면 — 스크롤·확대는 저장하지 않으므로 열 때마다 내용에 맞춘다 (FR-23)
  const initialData = useMemo(() => ({
    elements: restoreElements(parseSceneElements(drawing.scene) as unknown as OrderedExcalidrawElement[], null),
    scrollToContent: true
  // 연 순간의 것만 쓴다 — 이후의 바뀜은 sync가 캔버스에 넣는다
  }), [])

  const sync = useMemo(() => createDrawingSync({
    drawingId: drawing.id,
    load: (id) => client.drawings.get(id),
    save: (input) => client.drawings.saveScene(input),
    reconcile: (local, remote) => {
      const appState = api.current?.getAppState()
      const restored = restoreElements(remote as unknown as OrderedExcalidrawElement[], null)
      if (!appState) return [...remote]
      return reconcileElements(
        local as unknown as OrderedExcalidrawElement[],
        restored as unknown as RemoteExcalidrawElement[],
        appState
      ) as unknown as SceneElement[]
    },
    // 캔버스가 아직 없으면 연 순간의 장면이다 — 빈 배열을 돌려주면 빈 장면을 저장해 그림을 지운다
    getElements: () => (api.current?.getSceneElementsIncludingDeleted() as unknown as SceneElement[] | undefined)
      ?? parseSceneElements(drawing.scene),
    // 다른 창에서 온 것은 되돌리기 기록에 넣지 않는다 — 되돌리기가 남의 창이 그린 것을 지우면 안 된다
    apply: (elements) => {
      api.current?.updateScene({
        elements: elements as unknown as OrderedExcalidrawElement[],
        captureUpdate: CaptureUpdateAction.NEVER
      })
    },
    onDeleted: () => { latest.current.onDeleted() },
    onError: (message) => { latest.current.onStatus({ kind: 'failed', message }) }
  }, drawing),
  // 그림 하나에 동기화 하나다 — 다른 그림은 부르는 쪽이 key로 갈아끼운다
  [])

  const { schedule } = useDebouncedSave(async () => {
    latest.current.onStatus({ kind: 'saving' })
    const ok = await sync.save()
    if (ok) latest.current.onStatus({ kind: 'saved' })
    return ok
  })

  // 다른 창(또는 같은 그림을 연 다른 칸)이 저장했다 — 다시 읽어 합친다 (FR-21의 5)
  useItemChanged(drawing.workspaceId, 'drawing', () => sync.remoteChanged().catch(() => { /* 다음 알림이나 저장이 다시 본다 */ }))

  const onChange = useCallback((elements: readonly OrderedExcalidrawElement[]) => {
    if (sync.needsSave(elements as unknown as SceneElement[])) schedule('')
  }, [sync, schedule])

  // 그림 칸 안의 Esc는 Excalidraw의 것이다 — 도크 최대화·열린 항목 닫기로 새지 않게 (FR-28, 터미널과 같은 규칙)
  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') e.stopPropagation()
  }

  // 끌어 놓은 파일은 받지 않는다 — `.excalidraw`·장면이 든 PNG는 지금 그림을 통째로 바꾼다 (FR-27)
  function onDropCapture(e: DragEvent) {
    if (!blocksDrop(e.dataTransfer)) return
    e.preventDefault()
    e.stopPropagation()
  }

  return (
    <div className="drawing-canvas" onKeyDown={onKeyDown} onDropCapture={onDropCapture}>
      <Excalidraw
        excalidrawAPI={(instance) => { api.current = instance }}
        initialData={initialData}
        onChange={onChange}
        langCode="ko-KR"
        theme={dark ? 'dark' : 'light'}
        aiEnabled={false}
        validateEmbeddable={() => false}
        renderEmbeddable={() => null}
        onPaste={(data) => !blocksPaste(data)}
        UIOptions={{
          canvasActions: {
            loadScene: false,
            saveToActiveFile: false,
            export: false,
            saveAsImage: false,
            changeViewBackgroundColor: false,
            toggleTheme: false
          },
          tools: { image: false }
        }}
      >
        {/* 주 메뉴는 고른 것만 — 소셜 링크·Excalidraw+·불러오기가 없다 (FR-25). 자식을 넘기면 환영 화면도 서지 않는다 */}
        <MainMenu>
          <MainMenu.DefaultItems.SearchMenu />
          <MainMenu.DefaultItems.Help />
          <MainMenu.DefaultItems.ClearCanvas />
        </MainMenu>
      </Excalidraw>
    </div>
  )
}
