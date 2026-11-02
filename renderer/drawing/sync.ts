import type { Drawing, SaveSceneInput, SaveSceneResult } from '@shared/models'

/**
 * 그림 하나의 저장과 창 사이 합치기 (docs/sdlc/drawings/ spec FR-21). **Excalidraw를 모른다** — 이 모듈이 Excalidraw를 import하면
 * 앱 시작 번들에 그것이 통째로 든다(FR-20). 합치기 함수는 캔버스(`DrawingCanvas`)가 넘긴다.
 *
 * 같은 그림이 코드 칸과 별도 창에 같이 열릴 수 있다. 둘 다 고칠 수 있고, 저장은 낙관적 잠금이며, 충돌하거나 남이 저장했다는 알림이
 * 오면 요소 단위로 합친다. 합치기가 맞으려면 **지운 요소를 묘비(`isDeleted`)로 남겨 저장해야 한다** — 빼면 아직 그 요소를 가진
 * 다른 창이 그것을 되살린다.
 */

/** 이 모듈이 보는 요소의 모양 — Excalidraw 요소의 일부 */
export interface SceneElement {
  id: string
  version: number
  versionNonce: number
  isDeleted?: boolean
  [key: string]: unknown
}

/** Excalidraw 파일과 같은 머리에 요소 배열만 (core의 `EMPTY_SCENE`과 같은 모양) */
export function sceneText(elements: readonly SceneElement[]): string {
  return JSON.stringify({ type: 'excalidraw', version: 2, source: 'one-desk', elements })
}

export function parseSceneElements(scene: string): SceneElement[] {
  try {
    const parsed = JSON.parse(scene) as { elements?: unknown }
    return Array.isArray(parsed.elements) ? (parsed.elements as SceneElement[]) : []
  } catch {
    return []
  }
}

/**
 * 장면의 열쇠 — 저장할 것이 생겼는가를 가른다. Excalidraw는 요소를 고칠 때마다 `version`을 올리고 `versionNonce`를 바꾼다. 선택·스크롤·
 * 확대는 요소를 건드리지 않아 열쇠가 그대로다. 캔버스의 onChange가 포인터를 움직일 때마다 부르므로 글자를 이어 붙이지 않고 수로 잰다.
 */
export function sceneKey(elements: readonly SceneElement[]): string {
  let sum = 0
  let hash = 5381
  for (const e of elements) {
    sum += e.version
    hash = ((hash << 5) + hash + (e.versionNonce | 0)) | 0
  }
  return `${elements.length}:${sum}:${hash >>> 0}`
}

/** 충돌이 이만큼 이어지면 실패로 본다 — 사람 손으로 만드는 경합은 한두 번이면 끝난다 */
export const MAX_SAVE_ATTEMPTS = 3

export interface SyncDeps {
  drawingId: string
  /** 없으면 null (`client.drawings.get`) */
  load: (id: string) => Promise<Drawing | null>
  save: (input: SaveSceneInput) => Promise<SaveSceneResult>
  /** 지금 캔버스의 요소 + 받은 요소 → 합친 요소 (Excalidraw의 `reconcileElements`) */
  reconcile: (local: readonly SceneElement[], remote: readonly SceneElement[]) => SceneElement[]
  /** 지운 것까지 포함한 지금 캔버스의 요소 */
  getElements: () => readonly SceneElement[]
  /** 합친 요소를 캔버스에 넣는다 — 되돌리기 기록에 넣지 않는다 */
  apply: (elements: SceneElement[]) => void
  onDeleted: () => void
  /** 저장 실패의 이유 (지워진 것은 실패가 아니다) */
  onError?: (message: string) => void
}

export interface DrawingSync {
  /** onChange마다 — 저장을 걸어야 하는가 */
  needsSave(elements: readonly SceneElement[]): boolean
  /** 저장. 실패하면 false(창 닫기가 멈춘다, item-windows FR-16b). 지워진 그림은 저장할 것이 없어 true다 */
  save(): Promise<boolean>
  /** 이 workspace의 그림이 바뀌었다는 알림 — 다시 읽어 합친다 */
  remoteChanged(): Promise<void>
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function createDrawingSync(deps: SyncDeps, initial: Drawing): DrawingSync {
  /** 다음 저장의 기대값 — DB의 판 */
  let expected = initial.updatedAt
  /** DB의 그 판과 같은 장면의 열쇠. 지금 캔버스의 열쇠가 이것과 다르면 저장할 것이 있다 */
  let synced = sceneKey(parseSceneElements(initial.scene))
  /** 내가 보냈거나 보내는 중인 장면의 열쇠 — 알림이 응답보다 먼저 와도 내 메아리를 알아본다 */
  const mine = new Set<string>()
  /**
   * 지금 날아가는 저장의 열쇠. Excalidraw는 부모가 다시 그릴 때마다 같은 요소로 onChange를 부른다 — "저장 중" 표시가 그 계기다.
   * 이것을 보지 않으면 날아가는 장면을 또 걸어 대기 중인 저장이 늘 남고, 창 닫기(`guardUnload`)가 그것을 흘려보내느라 닫히지 않는다.
   */
  let saving: string | null = null
  let deleted = false

  function markDeleted() {
    if (deleted) return
    deleted = true
    deps.onDeleted()
  }

  /** 받은 장면을 지금 캔버스와 합쳐 넣는다 */
  function mergeIn(current: Drawing) {
    const remote = parseSceneElements(current.scene)
    deps.apply(deps.reconcile(deps.getElements(), remote))
    expected = current.updatedAt
    synced = sceneKey(remote)
  }

  return {
    needsSave(elements) {
      if (deleted) return false
      const key = sceneKey(elements)
      return key !== synced && key !== saving
    },

    async save() {
      if (deleted) return true
      try {
        for (let attempt = 0; attempt < MAX_SAVE_ATTEMPTS; attempt += 1) {
          const elements = deps.getElements()
          const key = sceneKey(elements)
          if (key === synced) return true
          mine.add(key)
          saving = key
          let result: SaveSceneResult
          try {
            result = await deps.save({ id: deps.drawingId, scene: sceneText(elements), expectedUpdatedAt: expected })
          } finally {
            saving = null
          }
          if (result.ok) {
            // 응답보다 늦게 온 남의 판이 이미 기대값을 올렸으면 내리지 않는다
            if (result.drawing.updatedAt > expected) {
              expected = result.drawing.updatedAt
              synced = key
            }
            return true
          }
          mergeIn(result.current)
        }
        deps.onError?.('다른 창과 계속 겹쳐 저장하지 못했습니다')
        return false
      } catch (err) {
        // 지워진 그림이면 저장할 것이 없다 — 창 닫기를 막지 않는다
        const now = await deps.load(deps.drawingId).catch(() => undefined)
        if (now === null) { markDeleted(); return true }
        deps.onError?.(messageOf(err))
        return false
      }
    },

    async remoteChanged() {
      if (deleted) return
      const current = await deps.load(deps.drawingId)
      if (current === null) { markDeleted(); return }
      if (current.updatedAt <= expected) return
      const remoteKey = sceneKey(parseSceneElements(current.scene))
      if (mine.has(remoteKey)) {
        // 내 저장의 메아리 — 캔버스는 이미 그 장면이거나 그보다 앞서 있다
        expected = current.updatedAt
        synced = remoteKey
        return
      }
      mergeIn(current)
    }
  }
}
