# UI 자동화 드라이버 설계

작성일: 2026-08-10
상태: 승인됨, 구현 계획 대기

## 왜 만드는가

2단계를 끝낼 때까지 화면 동작을 확인할 방법이 스크린샷을 찍어 눈으로 읽는 것뿐이었다. 그 방식으로도 결함 둘(`[NEEDS_ANSWER]` 표식 노출, 최종 응답 중복 렌더링)을 찾았지만, 사람이 매번 봐야만 잡히는 결함으로 남는다. 클릭할 수 없으니 "이슈를 누르면 칩이 담기는가" 같은 상호작용은 아예 검증 대상 밖이었다.

**목표는 화면에서만 드러나는 회귀를 사람 없이 잡는 것이다.** 부수적으로, 개발 중 앱을 직접 조작해 확인하는 통로가 생긴다.

## 범위

**포함:** Electron을 띄우고 조작하는 드라이버, 핵심 한 바퀴 e2e 하나.

**제외:** 취소·프리플라이트 실패·재시작 재현 경로, 시각 회귀 비교, CI 통합, 실제 `claude` 호출.

드라이버가 생기면 경로 하나를 더 덮는 것은 파일 하나짜리 일이 된다. 지금 다 덮지 않는 이유는 유지할 것을 먼저 최소로 두기 위해서다.

## 이 설계가 아닌 것

**제어용 HTTP API나 CLI가 아니다.** 설계 §4는 `OneDeskClient`를 전송 계층 이음매로 두고 "데몬 구조로 가면 HTTP 구현체로 갈아끼우면 된다"고 예고하며, §14는 자율 실행을 그 종착지로 둔다. 그 작업은 별개의 스펙이다.

**앱을 바깥에서 조종하는 목적만 놓고 보면 이 드라이버로 충분하다.** 창을 클릭할 수 있으면 사용자가 할 수 있는 모든 일을 할 수 있다. 새 API도, 포트도, 인증도 필요 없다. 제어 표면을 만드는 명분은 자율 실행 로드맵이지 개발 편의가 아니며, 그 둘을 섞으면 "쓰기 편하게"라는 이유로 제품에 영구적인 원격 제어 표면이 생긴다.

## 접근

**빌드된 `out/`을 Playwright의 `_electron`으로 띄운다.**

대안이었던 "dev 서버에 붙이기"는 vite 서버 생명주기를 테스트가 관리해야 해서 부품과 실패 지점이 늘어난다. 검증 대상은 "이 UI가 이렇게 동작하는가"이지 "dev 서버가 잘 뜨는가"가 아니고, 후자는 매일 `pnpm dev`로 확인된다.

빌드 경로를 쓰면 얻는 것이 하나 더 있다. `loadFile` 분기는 핸드오프 문서가 "패키징 빌드의 종료 경로가 미검증"으로 남겨둔 그 경로다. dev에서만 확인했던 종료 처리가 여기서 함께 돈다.

테스트 러너는 **vitest를 그대로 쓴다.** `playwright` 패키지에서 `_electron`만 빌려온다. `@playwright/test`를 추가하면 러너가 둘이 된다.

## 파일 구조

```
e2e/
├─ driver.ts           launchApp() — Electron 실행, 임시 userData, page 반환
└─ core-loop.e2e.ts    핵심 한 바퀴
vitest.e2e.config.ts   include: ['e2e/**/*.e2e.ts'], environment: node
```

- **`pnpm test`는 e2e를 집지 않는다.** 기존 두 프로젝트가 `core/**/*.test.ts`와 `renderer/**/*.test.{ts,tsx}`만 본다.
- `tsconfig.node.json`의 `include`에 `e2e/**/*`를 추가한다. 2단계에서 `Omit`이 유니온에 분배되지 않는 결함을 잡아낸 것이 typecheck였다.
- **ESLint는 손댈 것이 없다.** 경계 규칙이 `core/**`와 `renderer/**`에만 걸려 있어 `e2e/`는 recommended만 받는다.
- **e2e는 `@core`를 import하지 않는다.** DB나 로그 파일을 직접 읽어 단언하면 사용자가 보는 것이 아니라 내부를 검증하게 된다. 가짜 CLI 스크립트는 **경로로 가리킬 뿐 import하지 않으므로** 이 규칙과 어긋나지 않는다.
- `page.evaluate`를 쓰지 않고 locator API만 쓴다. DOM lib 없이 타입이 맞는다.

### 러너가 실제로 도는지 먼저 확인한다

2단계에서 `renderer/store/runEvents.test.ts`가 vitest include 패턴에 걸리지 않아 **테스트 9개가 없는 채로 성공 보고된 적이 있다**(실측 93 vs 102). 같은 사고가 새 config에서 반복될 수 있다.

**도입 직후 일부러 실패하는 e2e를 하나 넣어 실패가 보고되는지 확인하고 지운다.** 통과를 확인하는 것으로는 이 사고를 잡을 수 없다 — 안 도는 것과 통과하는 것이 똑같이 보이기 때문이다.

## 드라이버

```ts
export interface AppSession {
  page: Page
  /** 이 세션이 쓰는 임시 데이터 디렉토리 */
  dataDir: string
  /** repo로 등록할 임시 작업 디렉토리 */
  repoDir: string
  close(): Promise<void>
}

export function launchApp(): Promise<AppSession>
```

임시 `dataDir`과 `repoDir`을 만들고 환경변수를 실어 `_electron.launch({ args: ['out/main/index.js'], env })`. `close()`는 앱 종료와 임시 디렉토리 삭제를 하며 **테스트가 실패해도 반드시 돈다.**

**`env`는 반드시 `{ ...process.env, ... }`로 넘긴다.** Playwright의 `env`는 기존 환경을 물려받는 것이 아니라 통째로 **교체한다.** 부분만 넘기면 `PATH`가 사라지고, 그러면 어댑터의 preflight가 `claude`를 찾지 못해 run이 프리플라이트 실패로 끝난다. 가짜 CLI를 절대 경로로 주더라도 spawn된 프로세스가 `PATH` 없이 도는 것은 피해야 한다.

개발 중 즉석 조작에는 별도 장치를 만들지 않는다. `e2e/`에 임시 파일을 하나 떨궈 돌리고 지운다.

## 프로덕션 이음매 둘

### 1. 데이터 디렉토리 교체 — `electron/main.ts`

잠금을 요청하기 **전에** 처리한다.

```ts
const testDataDir = process.env['ONE_DESK_USER_DATA']
if (testDataDir) app.setPath('userData', testDataDir)

// 데이터 디렉토리가 다르면 같은 SQLite를 공유하지 않으므로 잠금이 필요 없다.
// 이 분기가 없으면 pnpm dev가 떠 있는 동안 e2e가 즉시 종료된다.
if (!testDataDir && !app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // 기존 초기화 전체
}
```

**1단계에서 일부러 넣은 방어를 조건부로 끄는 것이므로 의식적인 판단이다.** 잠금의 목적은 두 인스턴스가 같은 SQLite를 열어 서로의 종료 정리를 덮어쓰는 것을 막는 데 있다. 데이터 디렉토리가 다르면 그 위험 자체가 없다. 대안은 "dev와 e2e를 동시에 못 돌린다"를 받아들이는 것인데, 개발 중 앱을 띄워둔 채 e2e를 돌리는 것이 정상적인 사용이라 택하지 않았다.

### 2. 가짜 agent — `core/index.ts`

`resolveExecutable`의 최우선 순위에 환경변수를 둔다.

```ts
const override = process.env['ONE_DESK_AGENT_PATH']
const explicit = override ?? (agentKind === 'claude-code' ? ws?.claudePath : ws?.opencodePath)
```

`core/runner/fixtures/fake-claude.mjs`에 `#!/usr/bin/env node`와 실행 권한을 준다. 설계 §12가 "runner 생명주기는 진짜 CLI 대신 가짜 CLI 스크립트로 검증한다"고 이미 정해둔 방식이다. 실제 Claude를 부르면 e2e가 느리고, 비결정적이고, 돈이 든다.

**이 이음매는 위험을 늘리지 않는다.** 실행 파일 *경로*만 바꿀 뿐 권한 플래그는 그대로 적용된다. 앱은 이미 PATH에서 `claude`를 찾아 spawn하며, workspace 설정의 `claudePath`가 같은 성격의 경로 지정이다. 새로 생기는 능력이 없다.

## 핵심 한 바퀴

```
launchApp()
 1. workspace 만들기          → 사이드바에 뜨고 선택된다
 2. repo 등록 (임시 repoDir)   → repo 카드가 뜬다
 3. 이슈 만들기               → 목록에 뜨고 상태 open
 4. 이슈 제목 클릭             → 실행 패널에 그 제목으로 칩이 담긴다
 5. 권한을 읽기 전용으로        → select 값이 바뀐다
 6. 지시 입력 → ▶ 실행
 7. 도크에 탭이 즉시 생긴다     → running
 8. 로그가 흐른다              → '작업 중'
 9. 완료                      → succeeded, 결과 '끝남'
```

**7번이 이 테스트의 값어치다.** `execution.start()`가 완료를 기다리지 않는다는 계약을 UI 레벨에서 고정한다. 계획서 원안대로 종료까지 await했다면 탭이 몇 분 뒤에야 생기고 이 단언이 실패한다. 그 계약이 코드가 아니라 화면에서 지켜지는지 보는 유일한 지점이다.

4번과 9번은 2단계에서 사람 눈으로 확인했던 것을 자동화하는 자리다.

가짜 CLI의 `success` 시나리오가 `session` → `text('작업 중')` → `result('끝남')`을 내므로, 도크에는 세션 줄, 텍스트 줄, 구분선과 결과가 차례로 나타난다. `'끝남'`과 `'작업 중'`이 다르므로 result 본문이 접히지 않고 그대로 보인다.

## 오류 처리

- **실패 시 스크린샷을 `e2e/artifacts/`에 남긴다.** 화면을 볼 수 없으면 디버깅이 되지 않는다. `.gitignore`에 `e2e/artifacts/`를 추가한다.
- `close()`는 `try/finally`로 항상 돈다. 빠뜨리면 Electron 프로세스와 임시 디렉토리가 쌓인다. 2단계에서 고아 프로세스 하나가 단일 인스턴스 잠금 때문에 다음 실행을 통째로 막은 적이 있다.
- 앱 기동 타임아웃은 30초, 개별 단언은 5초. 가짜 CLI라 run 완료는 즉시다.
- 앱이 뜨지 않는 원인은 대개 "빌드하지 않은 것"이므로 스크립트가 빌드를 먼저 돌려 구조적으로 막는다.

## 운영

```json
"test:e2e": "electron-vite build && vitest run --config vitest.e2e.config.ts"
```

`pnpm test`에는 넣지 않는다 — 느리고 창이 뜬다. CI가 없으므로 로컬 전용이다.

## 완료 기준

- [ ] `pnpm test:e2e`가 핵심 한 바퀴를 통과한다
- [ ] 일부러 실패시킨 e2e가 실제로 실패로 보고된다 (러너가 도는지 확인 후 제거)
- [ ] `pnpm test`가 여전히 125개다 (e2e가 섞여 들어가지 않았다)
- [ ] `pnpm typecheck`, `pnpm lint` 통과 — `e2e/`도 대상에 든다
- [ ] `pnpm dev`가 떠 있는 상태에서 `pnpm test:e2e`가 돈다
- [ ] 실패 시 `e2e/artifacts/`에 스크린샷이 남는다
- [ ] 테스트 후 Electron 프로세스와 임시 디렉토리가 남지 않는다
