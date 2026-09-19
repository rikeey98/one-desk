import type { AppInfo, McpStatus, RevealTarget } from '@shared/models'

/**
 * 설정 화면의 정보 탭. 읽기 전용이다 (spec FR-10) — MCP 상태와 포트, DB 파일, 로그
 * 디렉토리, 앱 버전. 붙는 동작은 정해진 두 위치를 파일 탐색기로 여는 것뿐이고, 경로가
 * 아니라 이름을 넘긴다(NFR-3).
 *
 * state를 갖지 않는다. 조회 결과와 오류는 SettingsPanel이 쥔다 — 다른 탭과 같은 구조다.
 */
export function InfoTab({ info, infoError, revealError, mcpStatus, onReveal }: {
  info: AppInfo | null
  infoError: string | null
  revealError: string | null
  mcpStatus: McpStatus
  onReveal: (target: RevealTarget) => void
}) {
  const mcp = mcpStatus.state === 'listening' ? `MCP :${mcpStatus.port}`
    : mcpStatus.state === 'starting' ? 'MCP 시작 중'
    : `MCP 연결 실패 — ${mcpStatus.message}`
  return (
    <>
      {infoError && <div role="alert" className="form-error">{infoError}</div>}
      {revealError && <div role="alert" className="form-error">{revealError}</div>}
      <p className="settings-hint">문제가 생겼을 때 물어볼 값들입니다. 여기서는 아무것도 바꾸지 않습니다.</p>
      {/* 사이드바 하단 줄과 같은 상태를 같은 말로 보여준다 — 두 곳이 다르게 말하면
          어느 쪽을 믿어야 할지 모른다. */}
      <ul className="settings-status settings-info" aria-label="앱 정보">
        <li>MCP 서버: {mcp}</li>
        {info && (
          <>
            <li>앱 버전: {info.version}</li>
            <li>DB 파일: {info.dbFile}</li>
            <li>로그 디렉토리: {info.logDir}</li>
          </>
        )}
      </ul>
      {info && (
        <div className="settings-actions">
          <button type="button" onClick={() => onReveal('data')}>데이터 폴더 열기</button>
          <button type="button" onClick={() => onReveal('logs')}>로그 폴더 열기</button>
        </div>
      )}
    </>
  )
}
