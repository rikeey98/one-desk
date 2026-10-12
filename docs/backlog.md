# 백로그

설계 결정을 바꿀 필요는 없지만 아직 손대지 않은 작업을 모은다. 착수하는 항목은
`docs/sdlc/<기능>/`로 떼어 intent → spec → plan을 돈다. 설계 결정을 바꿔야 하는 대화
기능은 여기가 아니라 `docs/sdlc/conversation-next/intent.md`에 있다.

## 1. `@` 파일 참조에서 이번에 뺀 것 (2026-09-28)

`@` 파일 참조는 `docs/sdlc/input-triggers/`로 떼어 구현했다. 그 spec이 범위 밖으로 둔 것:

- **`@agent`**(하위 에이전트 짚기) — opencode만 뜻이 있다. claude에서 무엇을 보일지 정해야 한다.
- **`!` 셸 모드** — 헤드리스(`claude -p`·`opencode run`)에 대응하는 것이 없다.
- **줄 범위 `@a.ts#10-20`·디렉토리 참조** — 지금은 줄 범위를 붙여도 파일 전체가 실린다(spec §7의 8).
- **입력부의 "찾지 못한 참조" 경고** — 손으로 친 `@경로`가 해석되지 않으면 조용히 `＠` 글자로 간다
  (spec §7의 9). 두려면 입력마다 해석 IPC(`files.resolve`)가 하나 더 필요하다.
- **OpenCode Desktop 2.0.18 화면 캡처** — 피커 모양은 1.18.30 소스로 따랐다.
- **파일 원문이 `run.assembled_prompt`에 남는 것** — 보존 정책은 `conversation-next`에서 `raw.jsonl`과 함께
  정한다(spec §7의 7).

## 2. Bedrock·gateway 환경의 사용량 표시 — 보류 (2026-09-29)

구독 로그인의 5시간·7일 사용률(`docs/sdlc/plan-usage/`)과 같은 것을 Bedrock·사내 gateway에서도 보고 싶다는
요청. **보류 이유: "남은 양"을 주는 경로가 gateway마다 다른 사내 API라 범용 기능이 되지 않는다(사용자 판단).**

조사 결과(2026-09-29, 출처는 code.claude.com의 statusline·llm-gateway-protocol·claude-apps-gateway-spend-limits·
costs, AWS Bedrock quotas 문서):

- Claude Code는 Bedrock·API 키·일반 gateway에서 `rate_limit_event`을 내지 않는다. 읽는 한도 헤더는
  `anthropic-ratelimit-unified-*`뿐이고 LiteLLM·Kong의 `x-ratelimit-*`는 무시한다.
- 예외: Anthropic의 **Claude apps gateway**가 개인 지출 상한을 걸면 같은 unified 헤더를 싣는다 — stream-json의
  `rate_limit_event`로 오는지는 실측하지 않았다. 온다면 지금 코드가 창 이름만 늘려 그대로 그릴 수 있다.
- Bedrock 한도는 계정 공유의 분당 토큰(TPM)·일 토큰이고 응답에 남은 양이 없다. CloudWatch·Service Quotas는
  계정 전체 합계이고 개발자 SSO 권한으로는 대개 읽히지 않는다.
- 범용으로 가능한 것은 **앱이 이미 저장한 run 사용량(`costUsd`·토큰)의 기간 합계**뿐이다 — 앱 밖에서 쓴 양은
  빠지고, 예산은 서버 한도가 아니라 사용자가 적은 숫자다. LiteLLM이면 `GET /key/info`(spend·max_budget·
  budget_reset_at)가 진짜 남은 예산을 준다.

## 3. WSL repo — v0.25.1 실측이 기록만 한 것 (2026-10-12)

`docs/sdlc/wsl-support/` spec §4-B·§4-C의 실측과 반박 검토가 찾았지만 이번에 고치지 않은 것. 셋째 줄부터는 설계 결정을 다시 정해야 한다.

- **로그아웃한 claude가 "로그인 필요"가 아니라 "인증 확인 불가 (종료 코드 1)"로 보인다** — claude 2.1.296의 `auth status --json`은
  로그인하지 않았으면 exit 1로 `loggedIn: false`를 낸다(Windows·WSL 실측). 파서가 종료 코드를 먼저 봐서 그렇다. JSON을 먼저 보면
  고쳐지지만 agent-setup spec의 우선순위("실패하면 unknown")와 Windows 쪽 동작이 바뀐다 — 그 spec을 고칠지 먼저 정한다.
- **`ps`가 없는 배포판에서 런처가 setsid를 끝없이 되풀이한다** — `launcher.sh`가 pgid로 판정하고 `ps`가 실패하면 늘 setsid 갈래로
  간다. Ubuntu에는 procps가 있어 잠복이다. `/proc/$$/stat`로 판정하고 `setsid -w` + 한 번만 표식으로 막는 설계가 있다(§4-C 반박).
- **`~/.profile`이 `exec zsh` 같은 셸 바꾸기를 하면 stdin이 셸 코드로 읽힌다** — run의 프롬프트가 셸 명령으로 실행되고 run은 exit 0
  이다(반박 실측). 이번 개정 전부터 run에 있던 것이다. 런처와 `LOGIN_SHELL`을 stdin을 지키는 고정 상수로 함께 옮기는 안이 있다.
- **Bedrock 자격 증명이 만료된 WSL 사용자의 슬래시 커맨드 probe가 시간 초과로 굳는다** — init이 오지 않는데 `auth status`는
  로그인됨이라 실패가 `failedWhileLoggedIn`으로 캐시된다(command-cache-auth FR-3). 시간 초과는 캐시하지 않는 쪽을 정한다.
- **앱 종료(`cancelAll`)는 run에 TERM 없이 KILL을 보낸다** — claude가 Bash 도구의 자식(다른 세션)을 거둘 틈이 없어 앱을 끄면 run의
  dev 서버가 남을 수 있다. 실측하지 않았다(모델 호출이 든다).
