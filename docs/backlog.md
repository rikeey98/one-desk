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
