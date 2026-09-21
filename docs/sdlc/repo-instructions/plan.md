# Plan: repo의 지시 파일(CLAUDE.md·AGENTS.md) 보기

- 출처: `intent.md`, `spec.md` (2026-09-21 승인)
- 작성자: 권용현
- 상태: 구현 완료 (2026-09-21)
- 작성일: 2026-09-21

## 0. 먼저 적어 두는 것

**(A)는 설계를 바꾸지 않는다 — 되살린다.** asset 스캔 설계 §6-2는 discovered를 "읽기
전용으로 보여주고 경로를 함께 띄운다"고 정했는데, 구현이 자리표시자에서 멈춰 있었다.
본문을 DB에 두지 않는 §2-2도 그대로다 — 읽어서 보여줄 뿐 저장하지 않는다.

**읽기 함수는 하나다.** `core/assets/body.ts`의 `readAssetBody(row)`를 상세 보기와 실행
서비스(`resolveAssets`)가 함께 쓴다. 지금 `resolveAssets` 안에 박힌 `readFile`을 거기로
옮긴다. 기존 테스트 "파일이 사라진 asset을 담으면 조용히 빼지 않고 알린다"가 옮긴 뒤에도
초록이어야 한다.

## 변경되는 파일

전부 읽고 확인했다. 마이그레이션·스키마·MCP는 건드리지 않는다.

| 파일 | 신규/수정 | 변경 내용 |
| --- | --- | --- |
| `shared/models.ts` | 수정 | `AssetKind`에 `'instructions'`. `AssetBody` 타입(`{ ok: true; content } \| { ok: false; reason }`) |
| `shared/client.ts` | 수정 | `assets.readBody(id): Promise<AssetBody>` |
| `shared/channels.ts` | 수정 | `assetsReadBody: 'assets:readBody'` |
| `electron/preload.ts` | 수정 | `readBody: (id) => call<AssetBody>(…)` |
| `electron/ipc/assets.ts` | 수정 | `ipcMain.handle(CHANNELS.assetsReadBody, (_e, id) => core.assets.readBody(id))` 한 줄 |
| `core/assets/body.ts` | **신규** | `readAssetBody(row: Asset): Promise<AssetBody>` — authored는 DB 본문, discovered는 `readFile(filePath)`. 실패는 `{ ok: false, reason }` |
| `core/assets/body.test.ts` | **신규** | authored 본문·discovered 파일 내용·없는 파일의 reason에 경로 포함·`filePath`가 null인 discovered(깨진 행)도 던지지 않음 |
| `core/assets/scan.ts` | 수정 | `FoundAsset.kind`를 `AssetKind`로. `scanRepo`가 루트의 `CLAUDE.md`·`AGENTS.md`를 `instructions`로 더한다. 이름은 파일명 그대로 |
| `core/assets/scan.test.ts` | 수정 | 루트 두 파일 발견·frontmatter 없는 `CLAUDE.md`의 이름이 `CLAUDE.md`·둘 다 없으면 기존 셋만·`scanDir`(글로벌)은 루트 파일을 보지 않음 |
| `core/db/repositories/asset.ts` | 수정 | `createAuthored`가 `instructions`를 거부한다 |
| `core/db/repositories/asset.test.ts` | 수정 | 그 거부 테스트 |
| `core/index.ts` | 수정 | `assets.readBody(id)` — `assetRows.get(id)` → `readAssetBody` |
| `core/execution.ts` | 수정 | `collectContext`가 `instructions`를 거부한다(던진다). `resolveAssets`가 `readAssetBody`를 쓴다 |
| `core/execution.test.ts` | 수정 | `instructions` id를 담아 시작하면 run이 `failed`이고 `errorMessage`에 "지시 파일"이 있다 |
| `renderer/components/AssetPanel.tsx` | 수정 | `group('instructions', 'INSTRUCTIONS')` 추가. `instructions`면 담기 버튼을 렌더하지 않는다. 종류 드롭다운은 그대로(skill·agent) |
| `renderer/components/AssetPanel.test.tsx` | 수정 | 세 절이 보임·지시 파일 줄에 담기 버튼 없음(`queryByRole('button', { name: 'CLAUDE.md 맥락에 담기' })`가 null)·skill 줄에는 있음·드롭다운에 `instructions` 없음 |
| `renderer/components/AssetDetail.tsx` | 수정 | discovered면 마운트 시 `client.assets.readBody(asset.id)`를 불러 본문 또는 실패 문구를 textarea에 넣는다. 자리표시자 제거. 경로 줄은 남긴다 |
| `renderer/components/AssetDetail.test.tsx` | 수정 | discovered면 `readBody`가 그 id로 불리고 본문이 보임·`{ ok: false }`면 reason이 본문에 보임·authored는 `readBody`를 부르지 않음 |
| `e2e/asset.e2e.ts` | 수정 | repo 등록 전에 `CLAUDE.md`를 심는다 → `INSTRUCTIONS` 절에 `CLAUDE.md`·담기 버튼 없음·이름을 누르면 본문에 심은 문장 |
| `docs/superpowers/specs/2026-09-07-asset-scan-design.md` | 수정 | §6-2 끝에 한 줄 — 본문 표시가 `readBody`로 붙었고 지시 파일이 세 번째 종류가 됐다, 근거는 `docs/sdlc/repo-instructions/` |
| `CLAUDE.md` | 수정 | 문서 표에 행 하나. "현재 상태"에 한 문단(asset 종류 셋, 지시 파일은 담을 수 없음) |

**건드리지 않는 것과 그 이유**

- `core/db/schema.ts`·`drizzle/` — `kind`에 CHECK가 없다(spec FR-13). `git status`에 `drizzle/`
  변화가 없어야 한다.
- `core/context/assemble.ts` — `assetBlock('skill')`·`('agent')`만 있어 `instructions`는 어차피
  안 그려진다. 방어선은 그 앞 `collectContext`에 둔다(조용히 안 그리는 것과 거부하는 것은
  다르다 — FR-9).
- `core/assets/service.ts` — `scanRepo`가 돌려주는 목록을 그대로 upsert한다. 시각 규칙도
  그대로.
- `useAssets` — 목록 갱신 경로가 바뀌지 않는다.
- 설정 화면의 글로벌 경로 — 지시 파일은 repo 루트에서만(FR-11).

## 작업 순서

TDD다. 렌더러 테스트는 **Node 22**.

1. `shared/*` 넷 + `electron/*` 둘 — 타입·채널·preload·IPC 한 줄씩. `core.assets.readBody`가
   아직 없으므로 `electron/ipc/assets.ts`가 컴파일에서 빨갛다 — **완료 확인**: `pnpm typecheck`가
   정확히 그 자리 하나에서 실패한다. 다른 곳이 깨지면 표에 올린다.
2. `core/assets/body.test.ts` 넷 → `body.ts` — **완료 확인**: 넷 초록. 없는 파일의 `reason`에
   경로가 들어 있다.
3. `core/index.ts`에 `assets.readBody` — **완료 확인**: `pnpm typecheck` 통과.
4. `core/execution.ts`의 `resolveAssets`가 `readAssetBody`를 쓴다 — **완료 확인**:
   `execution.test.ts` 전체 초록. 특히 "파일이 사라진 asset을 담으면 조용히 빼지 않고 알린다".
5. `scan.test.ts` 넷 → `scan.ts` — **완료 확인**: 넷 초록, 기존 스캔 테스트 초록.
   `scanDir`(글로벌 루트가 쓰는 함수)은 루트 파일을 보지 않는다는 테스트가 포함돼 있다.
6. `asset.test.ts`에 `createAuthored({ kind: 'instructions' })` 거부 → `asset.ts` —
   **완료 확인**: 초록.
7. `execution.test.ts`에 `instructions` 거부 테스트 → `collectContext` — **완료 확인**: 초록.
   **변이**: 거부 분기를 지우면 빨개지는지 본다. 안 빨개지면 테스트가 `errorMessage`를
   안 보는 것이다.
8. `AssetPanel.test.tsx` 넷 → `AssetPanel.tsx` — **완료 확인**: 넷 초록, 기존 12개 초록.
   **변이**: 담기 버튼의 `instructions` 조건을 지우면 "담기 버튼 없음"이 빨개진다.
9. `AssetDetail.test.tsx` 셋 → `AssetDetail.tsx` — **완료 확인**: 셋 초록, 기존 초록.
   **변이**: `readBody` 호출을 지우면 본문 테스트가 빨개진다. 자리표시자 문구가 코드에서
   사라진 것을 grep으로 확인한다.
10. `e2e/asset.e2e.ts` — 등록 전에 `CLAUDE.md` 심기 → 단언 셋 — **완료 확인**:
    `pnpm exec electron-vite build && pnpm exec vitest run --config vitest.e2e.config.ts
    e2e/asset.e2e.ts` 통과. **짧은 라벨 함정**: 새 텍스트 `INSTRUCTIONS`·`CLAUDE.md`가 기존
    선택자에 걸리는지 e2e 전체를 돌려 본다.
11. 문서 둘 — **완료 확인**: `git diff`에 그 둘만.
12. 전체 검증 — `pnpm test`·`pnpm typecheck`·`pnpm lint`·`pnpm test:e2e`·`git status`에
    `drizzle/` 없음.
13. 커밋 하나 — `feat(assets): show discovered bodies and repo instruction files`.

## 리스크

| 리스크 | 영향 | 완화 방법 |
| --- | --- | --- |
| `readBody`에 경로를 받는 통로가 생긴다 | 렌더러가 임의 파일을 읽는다 | 시그니처가 `id`뿐이다(spec NFR-2). core 함수는 `Asset` 행만 받는다 — 경로는 DB에서만 온다 |
| 상세를 여는 동안 DB의 `content`(null)로 먼저 그렸다가 본문으로 바뀐다 | 빈 칸이 잠깐 보인다 | 읽는 동안은 "읽는 중…"을 본문에 두고, 도착하면 바꾼다. 실패도 본문에 들어간다(FR-2) |
| 지시 파일에 frontmatter가 있는 repo | `name`이 frontmatter 값으로 바뀌어 `CLAUDE.md`가 아닌 이름이 뜬다 | FR-6 그대로 — 지시 파일은 `name`을 무시하고 파일명을 쓴다. 테스트로 고정 |
| 같은 workspace의 여러 repo에 `CLAUDE.md`가 있다 | repo를 안 고르면 `CLAUDE.md`가 여럿 뜬다 | 의도다(FR-12). 출처 칸이 repo 이름을 보여준다. 동일성 키가 `file_path`라 행은 안 겹친다 |
| `resolveAssets`를 옮기며 "사라진 asset 알림"이 깨진다 | 담았는데 조용히 빠진다 | 4단계에서 그 기존 테스트가 초록인 것을 본다 |
| `AssetKind`가 넓어져 `switch`가 새는 곳 | 컴파일은 되는데 화면이 빈다 | 1단계 typecheck + `grep -rn "'skill'.*'agent'"`로 열거 자리를 전수 확인(스캔·패널·조립기 셋) |
| 옛 DB의 `instructions` 행은 없다 | 첫 재스캔 전까지 절이 빈다 | 부팅 스캔(`scanAll`)이 첫 실행에 채운다. 새로고침으로도 된다 |

## 완료 증명

- [x] `pnpm test` — 74 파일 통과, **1051개**(작업 전 1034 → +17)
- [x] `pnpm typecheck` 0 · `pnpm lint` 0
- [x] `pnpm test:e2e` 15 파일 통과 — `asset.e2e.ts`가 진짜 Electron 창에서 `INSTRUCTIONS`의 `CLAUDE.md`·담기 버튼 없음·이름 클릭 → 본문에 심은 문장·readonly까지 확인한다
- [x] `git status`에 `drizzle/` 변화 없음 — `kind` enum은 타입에만 있다
- [x] 변이 3건 각각 빨강 확인 후 되돌림: `collectContext` 거부 분기(`if (false && …)`) → 「거부된다」 빨강 / 패널의 `attachable = true` → 「담기 버튼이 없다」 빨강 / 상세의 effect 조건 반전 → 「readBody를 그 id로 부르고 본문을 보여준다」 빨강
- [x] `grep -rn "본문은 실행 시점에 이 파일에서 읽습니다" renderer/` 무출력
- [x] `readBody`는 IPC 핸들러 한 줄과 `AssetDetail` 한 곳뿐 — 경로를 넘기는 자리 없음
- [x] 경계 grep 둘 무출력
- [ ] 수동은 남긴다 — 이 저장소를 repo로 등록해 `INSTRUCTIONS`의 `CLAUDE.md`를 눌러 본다. e2e가 같은 경로를 진짜 창에서 밟았으므로 증거로는 충분하지만, 긴 문서가 textarea에서 어떻게 읽히는지는 눈으로 봐야 한다

## 계획 이탈 기록

- **1단계에서 깨진 자리가 하나 더 있었다.** `core/db/schema.ts`의 `kind` enum이 타입
  수준에서 `['skill','agent']`라 `createAuthored`의 `input.kind`가 안 맞았다. enum에 값을
  더했다 — CHECK 제약이 없어 SQL은 그대로고 `drizzle/`도 안 바뀌었다(검증함).
- **FR-9의 거부는 run 행이 생기기 전에 일어난다.** spec은 "실행이 실패로 끝나고
  `errorMessage`에 …"라고 적었는데, `collectContext`는 `runs.create` 앞에서 돌아 `start()`
  자체가 reject된다. workspace 밖 항목을 막는 `assertFound`와 같은 자리·같은 모양이라 그
  쪽을 따랐고, 테스트도 `rejects.toThrow(/지시 파일/)` + "run 행이 생기지 않았다"로 썼다.
  화면에서는 어차피 담기 버튼이 없어 사용자가 이 경로를 볼 일이 없다.
- **`readAssetBody`는 `filePath`가 null인 discovered도 던지지 않는다.** 계획에 적힌 대로
  깨진 행을 실패로 돌려준다 — 이 경우는 생기면 안 되지만, 생겼을 때 상세가 통째로 죽는
  것보다 "경로가 없습니다"가 낫다.
- **기존 `AssetDetail` 테스트 하나가 `readBody` mock이 없어 깨졌다.** 두 테스트 파일의
  `makeClient`에 기본 mock(`{ ok: true, content: '' }`)을 넣었다. 자리표시자 문구를 단언하던
  테스트는 없었다.
- **도구 함정 하나.** 이 세션의 셸 도구를 거치면 heredoc 안의 `\n`이 실제 줄바꿈으로
  바뀌어, 테스트 문자열 리터럴이 두 줄로 쪼개졌다. 파이썬으로 고치려는 시도도 같은 이유로
  세 번 헛돌았다("merged: 2"인데 바이트가 같았다). `chr(92)+'n'`으로 우회했다. 저장소와
  무관한 환경 문제라 코드에는 흔적이 없다.
