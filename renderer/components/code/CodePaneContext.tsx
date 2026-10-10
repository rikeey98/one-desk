import { createContext, useContext } from 'react'

/**
 * 대화록이 쓰는 "이 경로를 코드 칸에서 열기" (docs/sdlc/code-editor/ FR-23). Dock이 내린다 — 대화록(`TimelineBlocks`)은
 * 도크 안 여섯 겹 아래라 prop으로 내리지 않는다.
 *
 * **기본값은 null이고 던지지 않는다** — 대화록은 도크 밖(테스트)에서도 그려지고, 그때는 버튼이 없을 뿐이다. 그래서 이
 * 배선은 Dock 테스트가 고정한다("대화록의 버튼 → 칸이 열리고 그 파일").
 */
export interface CodePaneOpener {
  /** 칸의 대상 repo 경로 — 편집 줄의 CLI 경로를 repo 상대 경로로 바꾸는 기준(`code/editPath.ts`) */
  repoPath: string
  /** repo 상대 경로를 그 줄에 연다 */
  open: (path: string, line: number) => void
}

export const CodePaneContext = createContext<CodePaneOpener | null>(null)

export function useCodePaneOpener(): CodePaneOpener | null {
  return useContext(CodePaneContext)
}

/**
 * 코드 칸이 그려질 자리 — 앱 창 오른쪽 끝의 위아래 전체 열(안 B, 2026-10-10). App이 workspace 화면에서만 그 열을 두고
 * 내린다. 칸의 상태(열림·폭·대상 repo)는 그대로 도크가 쥐고 이 자리에 포털로 그린다 — 대상이 도크가 보는 대화라 상태를
 * App으로 올리면 도크의 선택·새 대화의 작업 디렉토리까지 따라 올라가야 한다.
 *
 * **자리가 없으면(null) 칸은 서지 않는다** — 버튼은 눌림 상태만 바뀐다. 도크를 혼자 그리는 테스트는 자리를 직접 내린다.
 */
export const CodePaneSlotContext = createContext<HTMLElement | null>(null)

export function useCodePaneSlot(): HTMLElement | null {
  return useContext(CodePaneSlotContext)
}
