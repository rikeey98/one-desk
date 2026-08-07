# 2단계 착수 전 처리 목록

작성일: 2026-08-08
근거: 1단계(`feature/stage1-skeleton-and-data`) 브랜치 전체 리뷰

1단계는 워크스페이스·repo·이슈·메모 관리까지 완성됐다. 2단계는 여기에 agent 실행 파이프라인을 얹는다 — `AgentAdapter`, 프로세스 spawn, 스트림 파싱, 하단 도크의 실시간 로그.

이 문서는 **2단계 코드를 쓰기 전에 손봐야 할 것**을 모은 것이다. 전부 1단계 리뷰에서 나왔고, 대부분 지금은 잠복 상태지만 2단계 코드가 올라가는 순간 실효 결함이 된다.

## 지금 손대야 싼 것

### 1. `main.ts`에 윈도우 참조가 없다

`mainWindow`가 `createWindow()`의 지역 변수다. 설계 §4의 단방향 이벤트 경로

```
core/runner (EventEmitter) → electron/ipc (webContents.send) → renderer
```

를 놓으려면 `webContents.send`를 부를 곳이 있어야 한다. 모듈 스코프 참조를 두고 `registerIpc(core, getWindow)`로 시그니처를 바꾸는 편이 낫다. 지금은 3줄이고, run 이벤트 코드를 쓰기 시작한 뒤에는 그 코드를 다시 손대야 한다.

### 2. 생명주기 훅이 하나도 없다

`app.on('before-quit')`도 `db.close()`도 없다. 스펙이 요구하는 두 동작을 걸 자리가 아직 없다.

- §6 — 앱 종료 시 실행 중인 agent 프로세스를 전부 정리
- §11 — 앱 시작 시 `running`/`pending` 상태인데 프로세스가 없는 run을 `interrupted`로 정리

**여기에 `db.close()`를 함께 붙이면 WAL 체크포인트가 결정적이 되어 백업 안전성도 올라간다.** 두 문제를 한 자리에서 해결할 수 있다.

### 3. 리포지토리 create/update에 트랜잭션이 없다

재현된 실패:

```ts
issues.create({ workspaceId, title: '고아 이슈', repoIds: ['없는-repo'] })
// issue INSERT 성공 → replaceTags가 FOREIGN KEY constraint failed로 throw
// 호출자에게는 실패로 보이지만 DB에는 태그 없는 이슈가 남는다
```

1단계 UI는 항상 유효한 `repoId`만 넘기므로 도달 불가능하다. **하지만 4단계 MCP의 `create_issue(title, body, repo_ids)`는 agent가 임의의 id를 넘길 수 있다.** 그 전에 `db.transaction()`으로 감싸야 한다.

### 4. 태그가 workspace 경계를 넘을 수 있다

재현된 실패: workspace A의 이슈에 workspace B의 repo id를 `repoIds`로 넘기면 그대로 저장된다. 외래키는 repo의 **존재**만 보장하고 소속은 보지 않는다.

스펙 §8은 "agent는 자신의 workspace 밖 데이터를 읽을 수도 수정할 수도 없다"를 MCP의 보안 경계로 약속한다. `replaceTags`에 workspace 검증이 없으면 그 약속이 깨진다.

### 5. `run_context_item`에 cascade를 관례적으로 붙이지 말 것

현재 외래키 7개가 전부 `ON DELETE cascade`이고 1단계에서는 이게 맞다. 하지만 같은 관례를 `run_context_item`에 적용하면 **이슈를 지웠을 때 그 이슈를 첨부했던 과거 run의 기록이 조용히 사라진다.** 스펙 §5가 asset에 대해 경고한 바로 그 상황이다. 2단계 스키마를 설계할 때 의식적으로 판단해야 한다.

### 6. 렌더러에 오류 표시 경로가 없다

`client.X.create()`가 거부되면 `await`가 throw하고 `finally`에서 busy만 풀린다. 사용자에게는 아무것도 표시되지 않고 콘솔에 unhandled rejection만 남는다.

1단계에서는 실질적 트리거가 디스크 오류 정도라 위험이 낮다. **2단계는 프리플라이트 실패·spawn 실패·CLI 미발견처럼 오류가 정상 흐름이므로 반드시 필요하다.**

## 확인만 하면 되는 것

### `pnpm dev`의 Vite 경로

샌드박스에서 localhost 접속이 막혀 개발 서버 경로를 검증하지 못했다. 프로덕션 빌드(`loadFile`)로는 전 구간이 실증됐다.

한 가지 의심 지점이 있다. dev 모드에서 Vite가 `index.html`의 `<head>` 앞머리에 react-refresh 프리앰블을 **인라인** `<script type="module">`로 주입하는데, `renderer/index.html`의 CSP가 `script-src 'self'`(unsafe-inline·nonce 없음)다. 주입 위치가 CSP `<meta>`보다 앞이라 정책 설치 전에 실행돼 통과할 가능성이 높지만 단정할 수 없다.

**흰 화면 + 콘솔에 `Refused to execute inline script`가 뜨면 이 문제다.** 해결은 dev에서만 `'unsafe-inline'`을 허용하거나 CSP를 `session.webRequest` 헤더로 옮기는 것.

## 이월된 사소한 것들

우선순위 낮음. 관련 코드를 건드릴 때 함께 처리하면 된다.

- **git author가 호스트명 유래** (`yonghyun-kwon@y-hyun-MacBookAir.local`). 원격에 푸시하기 전에 `git config user.email`을 설정해야 커밋이 계정에 연결된다.
- **백업 파일이 무한 누적된다.** `openDb`가 열릴 때마다 `.bak`이 하나씩 생기고 정리 로직이 없다. 보관 개수 상한을 두는 편이 낫다.
- **`CreateRepoInput`에 `sortOrder`가 없어 항상 0이다.** 실질적인 정렬은 이름순뿐이다. repo 순서 변경 UI를 도입할 때 함께 처리한다.
- **`memo.test.ts`에 `repoIds` 갱신 테스트가 없다.** `issue.test.ts`에는 있다. 의도된 중복 쌍이므로 테스트도 대칭이어야 드리프트를 잡는다.
- **`makeTestDb()`의 `migrationsDir: 'drizzle'`이 cwd 상대 경로다.** 지금은 vitest가 항상 루트에서 돌아 문제없지만 실행 위치에 묶여 있다.
- **잔재 파일**: `resources/icon.png`가 어디서도 참조되지 않는다(electron-builder는 `build/`를 쓴다). prettier 설정 3종이 있으나 `prettier`가 devDependencies에 없고 `format` 스크립트도 없다.

## 1단계에서 유지해야 할 것

2단계에서 무심코 완화하기 쉬운 것들이라 적어둔다.

**경계가 관례가 아니라 구조로 강제된다.** `tsconfig.web.json`에 `@core/*` 경로를 아예 넣지 않은 것과 ESLint `no-restricted-imports`의 이중 방어다. 사람이 지키는 규칙이 아니라 컴파일러가 지키는 규칙이라, 2단계에서 코드가 늘어도 무너지지 않는다. **여기는 절대 완화하지 말 것.**

**채널 상수 단일 출처.** preload와 핸들러가 같은 `CHANNELS` 객체를 참조해서, 오타로 인한 무응답 채널이 구조적으로 불가능하다. 2단계에서 채널이 두 배가 돼도 이 패턴이면 안전하다.

**의도된 중복이 실제로 "동일한" 중복이다.** `issue.ts`와 `memo.ts`의 공통 항목 필터 쿼리가 완전히 일치하고 `useIssues`/`useMemos`도 대칭이다. 승인된 중복이 드리프트하지 않는 것이 이 결정을 정당화한다. 한쪽을 고치면 반드시 다른 쪽도 고쳐야 한다.

**`closedAt`이 `status`에서 파생된다.** 호출자가 둘을 어긋나게 만들 수 없다. `needs_answer`를 추가할 때도 같은 원칙을 지키는 게 좋다.
