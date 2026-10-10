import type { TerminalData } from '@shared/models'

/**
 * 셸 출력을 칸에 이어 붙인다 (`docs/sdlc/code-editor/terminal-plan.md` 7단계).
 *
 * 칸은 **셸을 열기 전에 출력 구독부터 한다** — 열기의 응답(스냅샷)이 오는 사이에도 출력은 흐르기 때문이다. 그러면 스냅샷과
 * 그 사이 조각이 겹칠 수 있다. core가 조각마다 누적 시작 위치(`start`)를, 스냅샷에 끝 위치(`end`)를 붙이므로 이미 쓴 범위를
 * 잘라 낸다 — 같은 출력이 두 번 찍히지도, 빠지지도 않는다. 옛 셸(`generation` — `셸 다시 시작`)과 다른 repo의 조각은 버린다.
 * **지금보다 새 generation의 조각은 모아 둔다** — 다시 시작의 응답보다 새 셸의 첫 출력이 먼저 올 수 있다(generation은 core
 * 전체에서 오르기만 한다).
 */
export function createTerminalStream(repoId: string, write: (text: string) => void) {
  let session: { generation: number; end: number } | null = null
  let queued: TerminalData[] = []

  function accept(chunk: TerminalData): void {
    if (!session || chunk.generation !== session.generation) return
    const chunkEnd = chunk.start + chunk.data.length
    if (chunkEnd <= session.end) return
    const text = chunk.start < session.end ? chunk.data.slice(session.end - chunk.start) : chunk.data
    session.end = chunkEnd
    write(text)
  }

  return {
    /** 구독에서 온 조각. 붙기 전이면 모아 둔다 */
    push(chunk: TerminalData): void {
      if (chunk.repoId !== repoId) return
      if (!session || chunk.generation > session.generation) queued.push(chunk)
      else accept(chunk)
    },
    /** 열기(또는 다시 시작)의 응답 — 스냅샷을 쓰고, 모아 둔 조각 중 그 뒤의 것을 이어 쓴다 */
    attach(generation: number, snapshot: { text: string; end: number }): void {
      session = { generation, end: snapshot.end }
      if (snapshot.text) write(snapshot.text)
      const pending = queued
      queued = []
      for (const chunk of pending) accept(chunk)
    }
  }
}
