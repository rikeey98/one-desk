# Plan: 로그인한 뒤에도 슬래시 커맨드 목록이 실패로 남는 결함

- 출처: `spec.md` (같은 디렉토리)
- 작성자: 권용현 (초안: Claude)
- 상태: 구현 완료 (2026-09-28, 승인 2026-09-28)

## 변경되는 파일

| 파일 | 변경 |
| --- | --- |
| `core/commands/service.ts` | `CommandServiceDeps`에 `checkAuth: (target) => Promise<AgentAuthState>`를 **필수로** 더한다. `Entry`에 `failedWhileLoggedIn: boolean \| null`(성공이면 null — 구현하며 이름을 바꿨다). `list`·`agentInfo`가 공유하는 `entryFor(target)`: 캐시가 실패이고 `failedWhileLoggedIn === false`이면 인증을 다시 묻고 `ok`면 캐시를 버리고 `fetchOnce`. `load`가 실패하면 인증을 물어 적는다. 인증 조회가 던지거나 `unknown`이면 로그인하지 않은 것으로 본다 |
| `core/commands/service.test.ts` | 아래 테스트 |
| `core/index.ts` | `createCommandService`에 `checkAuth` 배선 — `claudeCodeAdapter.preflight(resolveAgentPath(...))` 뒤 `checkAuth('claude-code', executable, runCli)`의 `state`. 실행 파일이 없으면 `unknown`(= 로그인하지 않음으로 취급). `probeAgents(ws, true)`가 `repos.list(ws)`의 **모든** path를 `commands.invalidate` |
| `core/index.test.ts` | "다시 확인은 workspace의 모든 repo cwd를 비운다" |
| `docs/sdlc/slash-commands/spec.md` | FR-13 아래 개정 한 줄 |
| `docs/backlog.md` | §1 제거(착수 → 이 디렉토리) |
| `CLAUDE.md` | 슬래시 커맨드 문단의 "실패 결과도 수동 새로고침 전까지 유지"를 개정 문장으로, 문서 표에 행 하나 |

## 테스트 (전부 실패를 먼저 본다)

`service.test.ts`
1. 인증 `none`일 때 실패 → 로그인(`ok`) 뒤 `list`는 probe를 다시 띄우고 성공을 돌려준다.
2. 인증 `none`인 채로 다시 `list`하면 probe는 다시 뜨지 않는다(인증만 다시 묻는다).
3. 인증 `ok`에서 난 실패는 `list`를 몇 번 해도 probe도 인증 조회도 다시 돌지 않는다(FR-4).
4. 성공한 결과는 인증을 한 번도 묻지 않는다(FR-5).
5. 인증 조회가 던져도 `list`는 실패 결과를 정상으로 돌려준다(FR-6).
6. `agentInfo`도 1과 같이 동작한다 — 캐시를 공유하는 두 입구가 갈리지 않는다.

`index.test.ts`
7. repo 둘인 workspace에서 두 cwd 모두 캐시가 찬 뒤 `probeAgents(ws, true)` → 두 cwd 다 다음
   `list`에 probe가 다시 뜬다. (가짜 CLI 경로로 probe 횟수를 세기 어렵다면 `commands.invalidate`
   호출을 spy한다.)

**변이 확인:** `entryFor`의 재확인 분기를 지우면 1·6이, `probeAgents`의 반복을 `[0]`으로 되돌리면
7이 빨개지는지 본다.

## 완료 증명

`pnpm test`, `pnpm typecheck`, `pnpm lint`, 경계 grep 둘. 렌더러·IPC 변경이 없으므로 e2e는
기존 `e2e/slash.e2e.ts`·`settings` 계열이 초록인지만 본다.
