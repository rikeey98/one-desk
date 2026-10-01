/**
 * 이 창에서 아직 끝나지 않은 저장 (docs/sdlc/item-windows/ spec FR-15·FR-16a).
 *
 * 상세의 쓰기는 디바운스 자동 저장이고, 대기 중인 저장은 React 언마운트에서 흘려보낸다. **창을 닫는 것은
 * 언마운트가 아니다** — 그대로 두면 닫기 직전 600ms 안에 친 글자가 사라진다. 그래서 `useDebouncedSave`가
 * 여기에 자기를 올리고, `main.tsx`의 `beforeunload`가 비어 있지 않으면 닫기를 한 번 미루고 전부 흘려보낸 뒤
 * 스스로 닫는다.
 *
 * 항목은 "대기 중"만이 아니라 **저장이 날아가는 중**도 센다 — flush는 값을 꺼낸 뒤 IPC를 기다리는데, 그
 * 사이에 창이 닫히면 요청이 끝났는지 알 수 없다.
 */
export interface PendingSave {
  /** 대기 중이거나 저장이 날아가는 중인가 */
  busy(): boolean
  /** 끝까지 흘려보낸다. 저장이 실패했거나 충돌로 멈췄으면 false */
  flush(): Promise<boolean>
}

export interface PendingSaves {
  register(entry: PendingSave): () => void
  busy(): boolean
  /** 전부 흘려보낸다. 하나라도 실패하면 false — 닫지 않는다(FR-16b) */
  flushAll(): Promise<boolean>
}

export function createPendingSaves(): PendingSaves {
  const entries = new Set<PendingSave>()
  return {
    register(entry) {
      entries.add(entry)
      return () => { entries.delete(entry) }
    },
    busy() {
      for (const e of entries) if (e.busy()) return true
      return false
    },
    async flushAll() {
      const results = await Promise.all([...entries].map(async (e) => {
        try { return await e.flush() } catch { return false }
      }))
      return results.every(Boolean)
    }
  }
}

/**
 * 닫기를 미뤘다가 흘려보낸 뒤 닫는다. `beforeunload`에 건다 — `main.tsx`가 앱 창·패널 창 모두에 같은 것을
 * 쓴다(FR-16a). 바쁘지 않으면 아무것도 하지 않아 창이 그대로 닫힌다. 흘려보내는 동안 다시 닫기를 누르면
 * 같은 길을 한 번 더 탄다 — 끝난 뒤에는 바쁘지 않으므로 닫힌다.
 */
export function guardUnload(saves: PendingSaves, close: () => void) {
  let flushing = false
  return (event: BeforeUnloadEvent) => {
    if (!saves.busy()) return
    event.preventDefault()
    // Chromium은 returnValue가 있어야 미룬다(Electron은 대화상자 없이 닫기만 취소한다).
    event.returnValue = ''
    if (flushing) return
    flushing = true
    void saves.flushAll().then((ok) => {
      flushing = false
      if (ok) close()
    })
  }
}
