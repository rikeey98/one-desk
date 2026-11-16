# 답을 낸 뒤 백그라운드 작업을 기다리는 턴 — spec

2026-11-16. 사용자 보고: "헤드리스에서 백그라운드로 돌리면 세션은 끝났는데 뒤에서 조용히 돌고 있는 것 같다."

## 0. 실측

### Windows, claude 2.1.312 (one-desk와 같은 spawn — stdin을 닫고 `-p --output-format stream-json --verbose`)

90초 동안 도는 스크립트를 Bash `run_in_background: true`로 띄우게 했다.

| 시각 | 줄 |
|---|---|
| +5.1초 | `assistant` — Bash `run_in_background: true` |
| +5.8초 | `system/background_tasks_changed` — `tasks: [{ task_id, run_id, task_type: "local_bash", description }]` |
| +7.1초 | `assistant` — 답 |
| **+10.3초** | **첫 `result`** |
| +96.7초 | `system/task_notification`, `system/background_tasks_changed` — `tasks: []` |
| +99.0초 | `assistant` — 시키지 않은 턴이 한 번 더 돈다 |
| +101.6초 | 둘째 `result` |
| **+102.2초** | **프로세스 종료** (exit 0) |

종료 뒤 남은 프로세스는 없었다.

### 바이너리에서 읽은 것 (실측하지 않음)

- 대기 상한은 `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`, 기본 600,000ms다. 넘으면 stderr에
  `Background tasks still running … after the last turn (…); stopping them.`을 쓰고 죽인다.
- 셸을 기다리는 것은 서버 플래그에 달려 있다. 꺼져 있으면 5초 유예 뒤 죽인다.

### 9월 22일의 run 기록 (앱 데이터의 `b7032021`·`7458bf5f`)

그때의 claude는 마지막 `result` 5.4초 뒤에 프로세스가 끝났고 백그라운드로 띄운 에뮬레이터가 같이 내려갔다.
다음 턴의 agent가 "지난 세션이 끝나면서 같이 내려갔네요"라고 말한다.

### 재지 않은 것

- WSL의 claude 2.1.296 (로그인 만료).
- 상한에 닿아 죽인 뒤의 종료 코드.
- agent가 스스로 떼어 낸 프로세스(`nohup`·`Start-Process`·데몬). claude가 추적하지 않는다.
- OpenCode.

## 1. 문제

one-desk는 `result`가 아니라 프로세스 종료로 run을 끝낸다(`core/runner/manager.ts`의 `close`). 그래서 위
+10초 ~ +102초 동안 답은 화면에 와 있는데 run은 "실행 중"이고, 그 이유가 화면 어디에도 없다. 그동안 실행
슬롯을 차지하고 같은 대화의 예약 턴이 시작되지 않는다.

## 2. 하는 것

**이유를 보여 준다.** 동작은 바꾸지 않는다.

- **FR-1** claude 어댑터가 `system/background_tasks_changed`를 공지(`kind: 'background'`)로 낸다. 그 줄은
  지금 도는 작업의 **전체 목록**이다. 공지는 남은 작업 수 `pending`을 싣는다. 문구는 어댑터가 만든다:
  `백그라운드 작업 N개 실행 중 · <설명, …>`, 목록이 비면 `백그라운드 작업이 끝났습니다`. `tasks`가 배열이
  아니면 공지를 내지 않는다.
- **FR-2** 공지는 run의 상태·결과·실패 이유를 건드리지 않는다(다른 공지와 같다).
- **FR-3** 투영(`projectTurn`)의 `waiting` — 도는 턴이고, 마지막 백그라운드 공지의 `pending`이 1 이상이고,
  마지막 활동(text·tool_use·tool_result·reasoning·result)이 `result`일 때만 `{ pending, text }`다. 모델이
  아직 일하는 중이면 null이다. `pending`이 음이 아닌 정수가 아니면 null이다.
- **FR-4** 상태 줄 — `waiting`이면 첫 조각이 `작업 중` 대신 `답 도착 · 기다리는 중`이고 도구 자리에 그
  공지 문구가 선다(재시도 문구·도는 도구보다 먼저다). 멈추기 버튼은 그대로다 — 기다리기 싫으면 누른다.
- **FR-5** 펼친 턴의 공지선 — 시작과 끝이 제자리에 선다. 띄운 적 없이 온 빈 목록은 그리지 않는다.
  작업이 끝나 한 번 더 돈 턴의 답이 최종 답이고, 첫 답은 그 위의 text 블록으로 남는다.

## 3. 하지 않는 것

- **대기 시간을 줄이지 않는다** (사용자 결정, 2026-11-16). 일반 Claude Code는 백그라운드 작업을 끝날
  때까지 둔다. 상한을 줄이면 agent가 돌려 둔 작업을 one-desk만 일찍 죽인다.
- **첫 `result`에서 run을 끝내지 않는다.** 프로세스가 살아 있어 같은 세션을 `--resume`할 수 없다.
- **기다리는 동안 다음 지시를 보내는 것.** 지시마다 프로세스를 새로 띄우는 구조에서는 안 된다. 대화 내내
  프로세스 하나를 띄워 두는 구조가 필요하다 — `docs/ideas.md`.

## 4. 한계

- claude가 `background_tasks_changed`를 보내지 않는 판에서는 아무것도 보이지 않는다(예전 그대로다).
- 접힌 턴은 스토어만 본다. 앱을 다시 켠 뒤 여전히 도는 턴은 없으므로(부팅 때 중단됨으로 내린다) 걸리지 않는다.
- 목록 줄·홈의 "돌고 있는 것"은 그대로 "실행 중"이다.

## 5. 검증

- 단위: `claudeCode.detail.test`(문구·`pending`), `timeline.test`의 "waiting", `Transcript.test`의 상태 줄.
  구현 전에 열 개가 빨갰다.
- e2e: `e2e/background-wait.e2e.ts` — 가짜 CLI의 `ONE_DESK_FAKE_SCRIPT=background`(§0의 줄 순서,
  `ONE_DESK_FAKE_BG_MS`가 대기)로 상태 줄 → 완료 → 공지선 둘을 실제 앱에서 본다. 캡처는
  `e2e/artifacts/background-wait*.png`.
