# one-desk

workspace/repo/issue/memo를 한 화면에서 관리하고, 필요한 맥락을 골라 CLI 코딩 agent(Claude Code, OpenCode)에게 넘겨 헤드리스로 실행한 뒤 결과를 앱에 기록하는 Electron 데스크톱 앱.

**현재 상태:** 1단계 완료(맥락 관리 앱). 2단계(agent 실행 파이프라인) 착수 전.

## 명령어

**npm이 아니라 pnpm을 쓴다.**

```bash
pnpm dev          # 개발 실행
pnpm test         # Vitest (core=node, renderer=jsdom)
pnpm typecheck    # tsc --build
pnpm lint         # eslint
pnpm db:generate  # Drizzle 마이그레이션 생성
pnpm run pack     # 패키징 (pnpm pack은 내장 명령이라 다름 — run을 빼지 말 것)
```

## 절대 지켜야 할 경계 세 가지

깨지면 이후 단계가 무너진다. tsconfig와 ESLint가 강제하고 있으니 **우회하지 말고 설계를 다시 볼 것.**

1. **`core/`는 `electron`을 import하지 않는다.** 나중에 `core/`를 별도 데몬으로 떼어내기 위해서다. 경로가 필요하면 인자로 받는다 — `app.getPath()`를 core에서 부르면 안 된다.
2. **`renderer/`는 `core/`를 import하지 않는다.** `window.oneDesk` 참조는 `renderer/main.tsx` **한 곳뿐**이어야 한다. 컴포넌트는 `useClient()`를 쓴다.
3. **IPC 핸들러는 얇다.** core 메서드 호출만 하고 로직을 넣지 않는다.

확인:

```bash
grep -rn "from 'electron'" core/                        # 출력 없어야 함
grep -rn "window.oneDesk" renderer/ | grep -v main.tsx  # 출력 없어야 함
```

## 의도된 중복 — 합치지 말 것

`issue.ts`↔`memo.ts`, `useIssues.ts`↔`useMemos.ts`는 거의 같은 코드다. **실수가 아니라 사용자가 명시적으로 승인한 설계 결정이다.**

이슈에는 앞으로 상태 전이, agent 실행(run) 연결, `needs_answer`가 붙지만 메모에는 붙지 않는다. 지금 공통 헬퍼로 추출하면 다음 단계에서 되돌려야 하고, 그 비용이 중복을 유지하는 비용보다 크다.

**대신 두 쌍을 항상 대칭으로 유지한다.** 한쪽을 고치면 반드시 다른 쪽도 고친다. 어긋나면 그건 진짜 결함이다.

## 밟으면 조용히 깨지는 것들

전부 실제로 겪은 것들이다.

**preload 경로는 `../preload/index.mjs`다.** `package.json`에 `"type": "module"`이 있어 electron-vite가 preload를 `.mjs`로 내보낸다. `.js`로 "고치면" **창은 정상적으로 뜨는데 `contextBridge`가 실행되지 않아 `window.oneDesk`가 영원히 `undefined`**가 된다. 흰 창만 보고는 못 잡는다.

**`--output-format stream-json`은 `--verbose` 없이는 실행이 거부된다.** Claude Code 실측 확인.

**생성하는 권한 설정에 `ask`를 절대 넣지 않는다.** 헤드리스에서 물어보면 응답할 사람이 없어 프로세스가 그대로 멈춘다. 모든 정책은 `allow` 아니면 `deny`로만 떨어져야 한다.

**Vite dev 서버는 `127.0.0.1`로 고정돼 있다.** 기본값으로 두면 IPv6 `[::1]`에만 바인딩하는데 macOS는 `localhost`를 양쪽으로 해석해서 Electron이 `ERR_TIMED_OUT`으로 멈춘다. `electron.vite.config.ts`의 `server.host`를 지우지 말 것.

**better-sqlite3는 외래키를 기본으로 끄고 시작한다.** `openDb`의 `pragma('foreign_keys = ON')`이 없으면 스키마의 `onDelete: 'cascade'`가 전부 무효가 된다.

## 데이터 규칙

- **시각은 전부 epoch milliseconds 정수.** `Date.now()`로 명시 삽입한다. 스키마의 `unixepoch() * 1000` 기본값은 해상도가 초라서 같은 초에 만든 항목들의 정렬이 무너진다.
- **id는 `randomUUID()`.** 자동증가 정수가 아니다.
- **쓰기는 트랜잭션으로 감싼다.** 본문 INSERT와 태그 조작이 원자적이어야 한다.
- **태그로 붙이는 repo는 같은 workspace 소속인지 검증한다.** 외래키는 존재만 보장하고 소속은 보지 않는다.
- **`closedAt`은 `status`에서 파생된다.** 호출자가 따로 넘기게 하면 둘이 어긋난다.

## 컨벤션

- 들여쓰기 2칸, 함수명 camelCase, 상수 UPPER_SNAKE_CASE
- `verbatimModuleSyntax: true` — 타입 전용 import는 `import type`
- 주석과 오류 메시지는 한국어
- 테스트는 TDD로 — 실패를 먼저 확인하고 구현한다. 특히 **회귀 테스트를 추가할 때는 대상 코드를 잠시 망가뜨려 그 테스트가 실제로 실패하는지 확인할 것.** 1단계에서 트랜잭션 회귀 테스트가 다음 태스크의 검증 로직에 무력화돼, 트랜잭션을 통째로 지워도 통과하는 상태가 한동안 유지된 적이 있다.

## 문서

| 파일 | 내용 |
|---|---|
| `docs/superpowers/specs/2026-08-07-one-desk-design.md` | 전체 설계. 데이터 모델, 실행 파이프라인, 권한, UI, 구현 순서 |
| `docs/superpowers/specs/2026-08-07-implementation-notes.md` | 실측으로 검증된 CLI 사실과 파싱 코드 (큰 파일, 필요한 부분만 grep) |
| `docs/superpowers/specs/2026-08-08-stage2-handoff.md` | 2단계 착수 전 남은 장애물 |
| `docs/superpowers/plans/2026-08-08-stage2-agent-execution.md` | 2단계 구현 계획 (14개 태스크) |

**설계 문서의 결정을 코드에서 임의로 바꾸지 않는다.** 설계에 구멍이 보이면 고치지 말고 지적할 것 — 그게 더 값지다.
