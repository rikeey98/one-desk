# Plan: 대화의 확인된 결함 묶음

- spec: `./spec.md`
- 상태: 승인 위임됨 (2026-09-27)

## 작업 순서

서로 겹치는 파일(`manager.ts`, `execution.ts`, `run.ts`)이 있어 **순서대로** 한다. 각 단계는
TDD — 실패하는 테스트를 먼저 쓰고, 회귀 테스트는 대상을 잠시 되돌려 빨간 것을 확인한다.

1. **대표 턴과 두 칸 표** (FR-1~6) — `shared/inbox.ts` → `run.ts`의 `lastTurnsOf`/`inboxCounts`
   → `renderer/conversation.ts`(`state`/`active`) → `Dock.tsx`의 자동 확인·`ConversationList`의
   상태 점. `shared/inbox.test.ts`에 불변식 테스트.
2. **취소** (FR-7~11) — `execution.ts`의 launching 추적과 취소 요청, 뿌리 표시 조건,
   `manager.ts`의 타임아웃 → failed, `Dock.tsx` 헤더 취소 대상, `Transcript.tsx`의 실행 중 턴
   취소 버튼. `core/execution.test.ts:712-780`을 "다른 활성 턴이 없을 때"로 좁힌다.
3. **판정** (FR-12~14) — `manager.ts` 판정 순서, opencode `error` 줄, errorMessage 채우기,
   CLAUDE.md·설계 문서 문장.
4. **도구·세션·버전** (FR-15~17) — `permission.ts`, `onSession` + `saveExternalSessionId`,
   opencode preflight 버전 게이트(캐시).
5. **그 밖에** (FR-18~23) — `terminate.ts`, `readLog` 비동기 + 스토어 병합, `bridge.mjs`,
   `RenameField`, workspace 전환, e2e 헬퍼.
6. **CLAUDE.md 갱신과 전체 검증** — typecheck·lint·test·test:e2e.

## 리스크

- 대표 턴 규칙이 core·renderer에 따로 적히면 다시 갈린다 — 반드시 `shared/`의 한 함수.
- launching 추적이 슬롯·MCP 토큰 정리 경로를 하나라도 빠뜨리면 토큰이 새거나 슬롯이 준다.
  모든 조기 반환 경로에서 요청 표식을 치운다.
- Windows 단위 테스트의 가짜 CLI는 spawn되지 않아 run이 `start()` 안에서 끝난다 —
  "실행 중" 상태가 필요한 테스트는 기존처럼 수동으로 풀리는 manager 더블을 쓴다.

## 완료 증명

- **리뷰 반영(2026-09-27)** — 리뷰 지적 21건 중 재현된 것을 실패하는 테스트로 먼저 고정하고
  고쳤다(회귀 테스트는 대상을 되돌려 빨간 것을 확인). 반박 1건, 설계로 넘긴 3건은 spec §7.
  Windows 장비에서 전체 단위 테스트 1370개 통과(31개 건너뜀),
  `pnpm typecheck`·`pnpm lint` 통과.
- **1~5단계** — 단계마다 새 테스트가 구현 전에 빨간 것을 확인했고, 구현 뒤 대상 코드를
  되돌리는 변이로 회귀 테스트가 실제로 잡는 것을 확인했다(1단계: shared·core·renderer 변이
  12개, 2단계 14개, 3단계 11개, 4·5단계는 항목마다). 단계 끝의 전체 단위 테스트는
  1255 → 1271 → 1288 → 1325 → 1350개 통과로 늘었다(리뷰 반영 뒤 1370개).
- **최종 검증(6단계, 2026-09-27, Windows 11 · Node 22)** — CLAUDE.md 갱신 뒤 한 번에 돌렸다.

  | 명령 | 결과 |
  | --- | --- |
  | `pnpm typecheck` | exit 0 (`tsc --build --force`) |
  | `pnpm lint` | exit 0, 경고·오류 없음 |
  | `pnpm test` | 파일 87개 통과 · 2개 건너뜀(89), 테스트 **1370개 통과** · 31개 건너뜀(1401), 30.2초 |
  | `pnpm test:e2e` (1회차) | 파일 18개 통과 · 2개 건너뜀(20), 테스트 **31개 통과** · 2개 건너뜀(33), 93.2초 |
  | `pnpm test:e2e` (2회차) | 같은 결과 — 18/2 파일, 31/2 테스트, 92.1초. 플레이키 없음 |

  e2e에서 건너뛴 두 파일은 `ONE_DESK_REAL_CLI=1`일 때만 도는 `opencode-real.e2e.ts`·
  `slash-real.e2e.ts`다(진짜 CLI가 필요하다 — 이번 변경 범위의 실측은 단위 테스트와
  단계별 실측 기록이 대신한다). 5단계가 typecheck·lint만 통과시켜 둔 `e2e/rowAction.ts`의
  `clickRowAction`(delete·conversation e2e)과, 대화록·도크 헤더의 새 버튼("실행 중인 턴
  멈추기")이 기존 셀렉터와 부딪히지 않는 것이 이 두 번의 e2e로 확인됐다. 4단계가 걱정한
  "설정 화면이 가짜 CLI를 `--version`으로 띄우는 것"도 `settings.e2e.ts`·
  `workspace-defaults.e2e.ts`·`agent-setup.e2e.ts`를 깨지 않았다.
- **경계** — `grep -rn "from 'electron'" core/`와
  `grep -rn "window.oneDesk" renderer/ | grep -v main.tsx` 둘 다 출력 없음.
- **줄바꿈** — `git diff --stat | tail -1`과 `git diff --stat --ignore-cr-at-eol | tail -1`이
  같다. 새로 만든 파일에도 CR이 없다.
- **문서** — CLAUDE.md에 "현재 상태" 절과 함정 항목을 더하고 고쳤다(대표 턴, 두 칸 표,
  취소 조건·launch 중 취소, 판정 순서, 실패 이유, Task* 도구, 세션 id 즉시 저장, 2.x 게이트,
  Windows 트리 종료, 브리지의 응답 고르기, e2e 줄 끝 버튼 헬퍼, 도크의 턴 셋·workspace 전환,
  로그 병합, 이름 비우기). 그 밖에 FR-13을 "미해결"로 적어 둔 문서 셋
  (`docs/windows-setup.md` §3·§8, `docs/sdlc/run-info/spec.md` §8, 설계 2026-09-06 §6-2의
  정정 블록)에 해결 표시를 덧붙였다. 원문은 지우지 않았다.
- **2.x 게이트 실측** (2026-09-27) — 데스크톱 번들 `opencode-cli.exe --version`은 `opencode v2.0.18`,
  PATH의 WinGet 설치본은 `1.18.30`을 찍는다. `parseOpencodeVersion`의 정규식이 둘 다 읽어 앞은
  막고 뒤는 통과시킨다.
