/**
 * 패널 창의 범위 (docs/sdlc/item-windows/ spec FR-1·FR-13).
 *
 * 창 하나 = (종류, workspace, repo 또는 전체). 창이 무엇을 그릴지는 앱 문서의 해시로 정한다 —
 * main은 이 함수로 해시를 만들고, 렌더러(`main.tsx`)는 같은 함수로 읽는다. main에는 단위 테스트가
 * 없어 판정을 여기 둔다(`links.ts`와 같은 이유).
 */
export type PanelKind = 'issue' | 'memo' | 'asset'

export const PANEL_KINDS: readonly PanelKind[] = ['issue', 'memo', 'asset'] as const

export interface PanelScope {
  kind: PanelKind
  workspaceId: string
  /** null = workspace 전체 */
  repoId: string | null
}

const PREFIX = 'panel'
const ALL = 'all'

export function panelHash(scope: PanelScope): string {
  const repo = scope.repoId === null ? ALL : encodeURIComponent(scope.repoId)
  return `#${PREFIX}/${scope.kind}/${encodeURIComponent(scope.workspaceId)}/${repo}`
}

/** 패널 창의 해시가 아니면 null — 앱 창이다. 모양이 틀린 패널 해시도 null이다. */
export function parsePanelHash(hash: string): PanelScope | null {
  const body = hash.startsWith('#') ? hash.slice(1) : hash
  const parts = body.split('/')
  if (parts.length !== 4 || parts[0] !== PREFIX) return null
  const [, kind, ws, repo] = parts as [string, string, string, string]
  if (!(PANEL_KINDS as readonly string[]).includes(kind)) return null
  if (ws === '' || repo === '') return null
  try {
    return {
      kind: kind as PanelKind,
      workspaceId: decodeURIComponent(ws),
      repoId: repo === ALL ? null : decodeURIComponent(repo)
    }
  } catch {
    return null
  }
}

/** 해시가 패널 창을 가리키는가 — 모양이 틀려도 `#panel/`로 시작하면 패널 창이다(앱 창을 그리지 않는다). */
export function isPanelHash(hash: string): boolean {
  return hash.replace(/^#/, '').startsWith(`${PREFIX}/`)
}

/** 창 지도의 키. 같은 범위의 창은 하나다(FR-3). */
export function panelScopeKey(scope: PanelScope): string {
  return panelHash(scope)
}
