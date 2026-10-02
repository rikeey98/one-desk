# CLI 경로 — 앱 기본값과 workspace 예외 (spec)

2026-10-02. 사용자 요청: "path를 따로 설정해도 workspace마다 설정해야 함 — 한 번에 적용하고 예외로 할 수 있게."
예외 단위는 사용자가 **workspace**로 골랐다(repo별은 마이그레이션이 드는 다른 안이었다).

## 1. 문제

`claude_path`·`opencode_path`는 `workspace` 컬럼뿐이다. npm 설치처럼 PATH 탐색이 실패하는 장비에서는 workspace를
만들 때마다 같은 경로를 다시 넣어야 하고, 하나를 빠뜨리면 그 workspace만 "찾을 수 없습니다"로 막힌다.

## 2. 결정

### FR-1 해석 순서

`ONE_DESK_AGENT_PATH` → **workspace 경로(예외)** → **앱 기본 경로(새로)** → 어댑터의 PATH 탐색.

판정은 여전히 `resolveAgentPath` 한 함수다. 앱 기본값은 **필수 인자**다 — 선택이면 여섯 호출 자리(실행·설정 화면의
`checkAgents`·`probeAgents`·슬래시 커맨드 probe·인증 확인) 중 하나만 빠뜨려도 조용히 컴파일되고, 그러면 설정 화면은
초록인데 실행은 막히는 상태가 생긴다(CLAUDE.md "`checkAgents`는 실행과 같은 판정을 써야 한다").

### FR-2 저장

앱 기본값은 `app_setting` 키-값 표의 두 키(`agents.path.claude`·`agents.path.opencode`)다. **마이그레이션 없음.**
빈 값(공백뿐 포함)은 "없음"이고 읽으면 null이다. 저장은 둘을 함께 받는다 — 부분 갱신을 받지 않는다(`updatePaths`와 같은 규칙).
저장은 경로가 쓸 만한지 보지 않는다 — 판정은 preflight의 몫이다(workspace 경로와 같다).

### FR-3 화면

- **앱 탭**의 첫 절 `CLI 기본 경로` — 두 칸(`Claude Code 기본 실행 파일`·`OpenCode 기본 실행 파일`)과 `CLI 기본 경로 저장`.
  절마다 저장이 따로인 규칙 그대로다.
- **실행 탭**의 절은 `CLI 경로 — 이 workspace만`으로 바뀐다. 빈 칸의 placeholder가 지금 따르는 값을 말한다:
  앱 기본값이 있으면 `앱 기본값: <경로>`, 없으면 `앱 기본값 따름 (PATH에서 찾기)`.
- 실행 탭의 CLI 상태(`AgentStatusList`)는 앱 기본값을 저장한 뒤에도 다시 확인한다 — 그 workspace가 예외를 두지 않았으면
  잡히는 실행 파일이 바뀐다.

## 3. 빠지는 것

- repo별 예외.
- 기존 workspace 경로를 앱 기본값으로 옮기는 마이그레이션 — 이미 넣은 값은 그대로 예외로 남는다. 지우면 앱 기본값을 따른다.
- 경로를 바꿨을 때 슬래시 커맨드 실패 캐시를 비우는 것 — workspace 경로를 바꿀 때도 비우지 않는다(설정의 `다시 확인`이 비운다).
