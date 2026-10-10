import { guardUnload, type PendingSaves } from './pendingSaves'
import type { CloseFailure, CodeBufferStore } from './codeBuffers'
import type { FileSaveInput, FileSaveResult } from '@shared/models'

export type CloseAnswer = 'save' | 'discard' | 'cancel'

/**
 * 앱 창의 `beforeunload` 판정 하나 (docs/sdlc/code-editor/ spec FR-21·§4의 6).
 *
 * 1. 대기 중인 저장(이슈·메모 본문의 디바운스)이 있으면 지금처럼 미루고 흘려보낸 뒤 스스로 닫는다(`guardUnload`).
 *    그 `close()`가 다시 부른 `beforeunload`에서 2를 본다 — 순서가 자연히 "흘려보내고 그다음 묻는다"다.
 * 2. 코드 칸에 저장하지 않은 고침이 있으면 닫기를 멈추고 스토어에 확인을 요청한다 — App의 `CloseConfirm`이 그린다.
 *    Electron은 막힌 `beforeunload`에 대화상자를 띄우지 않으므로 묻는 것은 앱 안이다.
 * 3. 둘 다 없으면 막지 않는다.
 *
 * 패널 창은 이것을 쓰지 않는다 — 코드 칸이 없다(spec §4의 7). 거기는 `guardUnload` 그대로다.
 */
export function createCloseGuard({ saves, buffers, close, save }: {
  saves: PendingSaves
  buffers: CodeBufferStore
  close: () => void
  save: (input: FileSaveInput) => Promise<FileSaveResult>
}) {
  const pending = guardUnload(saves, close)
  /** `저장하지 않고 닫기`를 고른 뒤 — 다음 닫기를 막지 않는다 */
  let bypass = false

  return {
    onBeforeUnload(event: BeforeUnloadEvent): void {
      if (bypass) return
      if (saves.busy()) {
        pending(event)
        return
      }
      if (buffers.dirty().length === 0) return
      event.preventDefault()
      // Chromium은 returnValue가 있어야 미룬다(Electron은 대화상자 없이 닫기만 취소한다).
      event.returnValue = ''
      buffers.requestClose()
    },

    async answer(choice: CloseAnswer): Promise<void> {
      if (choice === 'cancel') {
        buffers.clearCloseRequest()
        return
      }
      if (choice === 'discard') {
        bypass = true
        buffers.clearCloseRequest()
        close()
        return
      }
      const failures: CloseFailure[] = []
      for (const ref of buffers.dirty()) {
        const buffer = buffers.get(ref)
        if (!buffer) continue
        const text = buffer.text
        try {
          const result = await save({ ...ref, content: text, expectedHash: buffer.baseHash })
          if (result.ok) buffers.markSaved(ref, text, result.hash)
          else if (result.conflict) {
            failures.push({
              path: ref.path,
              reason: result.conflict.deleted ? '디스크에서 지워져 저장하지 않았습니다' : '디스크에서 바뀌어 저장하지 않았습니다'
            })
          } else failures.push({ path: ref.path, reason: result.reason })
        } catch (err) {
          failures.push({ path: ref.path, reason: err instanceof Error ? err.message : String(err) })
        }
      }
      // 실패한 것이 있으면 닫지 않는다 — 무엇이 왜 남았는지 확인 창에 남긴다(그 파일이 다른 repo일 수 있어 칸에 열지 않는다).
      if (failures.length > 0) {
        buffers.requestClose(failures)
        return
      }
      buffers.clearCloseRequest()
      close()
    }
  }
}

export type CloseGuard = ReturnType<typeof createCloseGuard>
