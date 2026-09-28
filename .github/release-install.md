## 설치 (Windows)

`one-desk-*-x64.exe`는 포터블 실행 파일입니다. 설치 없이 바로 실행됩니다.
SmartScreen 경고가 뜨면 "추가 정보" → "실행"을 누르세요.

## 첫 실행 전에

**agent CLI가 하나 이상 설치돼 있어야 합니다.** 어느 것으로 돌릴지는 실행
패널의 agent 드롭다운에서 run마다 고릅니다. 기본값은 Claude Code입니다.

### Claude Code

흔한 설치 위치는 자동으로 찾습니다. 못 찾으면 workspace 설정의
"claude 경로"에 `where.exe claude` 결과를 넣으세요.

npm 전역 설치(`claude.cmd`)는 지원하지 않습니다 — Node가 배치 파일을
직접 실행하지 못해서(CVE-2024-27980) 프리플라이트에서 거부됩니다.
네이티브 설치 스크립트로 `claude.exe`를 설치해 주세요.

AWS Bedrock 환경이라면 `CLAUDE_CODE_USE_BEDROCK` 같은 값이 **Windows
사용자/시스템 환경 변수**에 등록돼 있어야 합니다. PowerShell 프로필에만
있으면 앱이 물려받지 못합니다.

### OpenCode

`opencode`를 설치하고 로그인해 두세요. 경로를 못 찾으면 workspace 설정의
"opencode 경로"에 넣습니다. `.cmd` 설치본을 거부하는 것은 Claude Code와
같은 이유입니다.

모델은 `provider/model` 형식으로 적습니다 — 예: `anthropic/claude-sonnet-4-5`.

**작업할 repo에 `opencode.json`이 있고 거기 권한이 "물어보기"(ask)로 적혀
있으면 실행을 거부하고 어떤 키가 문제인지 알려줍니다.** 헤드리스 실행에는
물음에 답할 사람이 없어 그대로 멈추기 때문입니다. 그 항목을 지우거나
allow/deny로 바꾸면 됩니다 — one-desk가 만드는 설정으로는 그 파일을
덮어쓸 수 없습니다.

대화를 이어갈 때는 agent가 잠깁니다. 세션은 그것을 만든 CLI의 것이라
다른 CLI로 이어받을 수 없습니다.

## macOS / Linux

이 릴리스는 Windows 산출물만 담습니다. 다른 플랫폼이 필요하면
저장소를 받아 `pnpm run pack`으로 직접 빌드하세요.
