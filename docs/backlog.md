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
