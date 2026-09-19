# Plan: 탭 기반 설정 화면

- 출처: `intent.md`, `spec.md` (2026-09-19 승인)
- 작성자: 권용현
- 상태: 승인됨 (2026-09-19) · **2026-09-19 개정**
- 작성일: 2026-09-19

## 개정 기록

**2026-09-19 — 현실에 맞춰 다시 썼다.** 초판을 쓰던 중 다른 작업(task_926353a6)이 브리프를
넘어 `SettingsPanel`까지 구현해 들어왔다(`claude/agitated-goldwasser-a33cea`, `e0ce778`,
20개 파일 +1,645줄). 초판의 13단계 중 **다섯이 이미 끝났고**, 저장 방식은 spec의 FR-11과
정반대로 구현됐다. 그 코드는 검증됐으므로(아래) 계획을 코드에 맞추고, spec의 FR-11을
개정했다(spec의 변경 기록).

검증 결과(워크트리에서 실측, 2026-09-19 17:30): `typecheck` 통과 · `lint` 통과 ·
`vitest run` **921 통과 / 28 건너뜀** · e2e **18 통과 / 2 건너뜀**.

## 이미 끝난 것 (`e0ce778`)

| 초판 단계 | 상태 | 실제 구현 |
| --- | --- | --- |
| 1. 전제(모델 배선) | **끝** | `RunPanel`의 `defaultModelOf(workspace, agentKind)`. agent를 바꾸면 모델 칸이 따라 바뀌고, 대화를 이어갈 때는 마지막 턴의 모델이 이긴다 |
| 2. `workspace.updateDefaults` | **끝** | 단 **부분 갱신이 아니다** — agent·모델 둘·권한을 전부 받는다. CLI 경로는 `updatePaths`로 갈라져 있다 |
| 5. IPC 왕복(workspace 쪽) | **끝** | `workspacesUpdateDefaults`·`updatePaths`·`checkAgents` |
| 8. `실행` 탭 내용 | **끝** | 기본값 네 칸 + CLI 경로 둘. 권한을 전체 허용으로 **올릴 때만** `ConfirmButton`으로 확인(FR-6) |
| 11. `App.tsx` 배선(일부) | **끝** | `workspaces`·`workspaceId`·`onWorkspaceSaved` |
| — | **덤** | `checkAgents` — 지금 이 workspace로 실행하면 두 CLI가 각각 어디서 잡히는지 표시. 계획에 없던 것이다 |

**남은 것은 껍데기와 나머지 두 탭이다.** 지금 화면은 탭이 아니라 `h3` 절 셋이 쌓인 한 장이다.

## 그대로 유효한 판단

초판의 넷 중 둘은 구현이 그대로 따랐고(`App.tsx`의 prop 하강, 부분 갱신 금지), 나머지 둘은
아직 살아 있다. 여기에 이번에 하나를 더한다.

1. **경로 치환은 asset *저장소*에 둔다.** `movePathPrefix`는 트랜잭션과 유니크 인덱스를
   다루므로 서비스가 아니라 저장소의 관심사다.
2. **`app.info()`는 core가 조립하지 않는다.** 앱 버전은 electron의 것이므로 core에
   `paths()`를 두고 **main이 버전을 더한다** — 경계 규칙 1.
3. **상한은 `App`이 든 `useQueue`를 그대로 내려받는다.** 설정이 자기 인스턴스를 만들면
   도크와 서로의 변경을 모른다(FR-7).
4. **초안 state는 `SettingsPanel`에 남긴다.** 지금 모든 입력(글로벌 경로 둘·기본값 넷·CLI
   경로 둘)이 이 컴포넌트의 state다. 탭을 나누며 그 state를 자식으로 내리면 **탭을 옮길 때
   언마운트되어 입력이 사라진다** — FR-11이 지키려는 바로 그 약속이 깨진다.

## 변경되는 파일

| 파일 | 신규/수정 | 변경 내용 |
| --- | --- | --- |
| `core/db/repositories/repo.ts` | 수정 | `update(id, patch)` — 이름·설명·경로 |
| `core/db/repositories/repo.test.ts` | 수정 | 경로 변경, 빈 경로 거부 |
| `core/db/repositories/asset.ts` | 수정 | `movePathPrefix({ workspaceId, repoId, from, to })` 트랜잭션 |
| `core/db/repositories/asset.test.ts` | 수정 | 접두사 치환, 글로벌(`repo_id IS NULL`) 제외, 충돌 롤백 |
| `core/index.ts` | 수정 | `repos.update`(치환 → 재스캔), `paths()` |
| `core/index.test.ts` | 수정 | 경로 변경이 재스캔까지 가는지 |
| `shared/models.ts` | 수정 | `UpdateRepoInput`, `AppInfo`, `RevealTarget` |
| `shared/channels.ts` | 수정 | `reposUpdate`, `appInfo`, `appReveal` |
| `shared/client.ts` | 수정 | 같은 모양의 메서드 셋 |
| `electron/ipc/repos.ts` | 수정 | 핸들러 하나 |
| `electron/ipc/app.ts` | 신규 | `appInfo`(버전 합성), `appReveal`(`'data' \| 'logs'`만) |
| `electron/ipc/index.ts` | 수정 | `registerAppHandlers` 한 줄 |
| `electron/preload.ts` | 수정 | 브리지 셋 |
| `renderer/components/SettingsPanel.tsx` | 수정 | 탭 넷의 껍데기로. **초안 state는 여기 남는다** |
| `renderer/components/SettingsPanel.test.tsx` | 수정 | 기존 테스트는 탭을 먼저 고르도록만 손본다. 탭 전환이 입력을 지우지 않는 테스트를 **추가**한다 |
| `renderer/components/settings/RepoTab.tsx` | 신규 | repo 목록과 경로·이름·설명 편집 |
| `renderer/components/settings/RepoTab.test.tsx` | 신규 | 경로 저장, 존재하지 않는 경로 |
| `renderer/components/settings/InfoTab.tsx` | 신규 | MCP·경로·버전, 열기 버튼 둘 |
| `renderer/components/settings/InfoTab.test.tsx` | 신규 | `failed` 메시지 표시 |
| `renderer/App.tsx` | 수정 | `repos`·`refreshRepos`·`queue`·`onChangeLimit`·`mcpStatus` 추가 하강 |
| `renderer/App.test.tsx` | 수정 | **배선 테스트** — 추가한 prop을 지우면 실패해야 한다 |
| `e2e/settings.e2e.ts` | 신규 | 수용 기준 5·8과 탭 전환 |
| `docs/windows-setup.md` | 수정 | §4의 SQL 안내를 설정 화면 안내로 |
| `CLAUDE.md` | 수정 | repo 경로 변경과 asset 동일성 함정 한 줄 |

**마이그레이션 없음.**

## 작업 순서

1. **브랜치 병합** — `claude/agitated-goldwasser-a33cea`(`e0ce778`)를 `main`에 합친다.
   **완료 확인**: `main`에서 `pnpm test`·`pnpm test:e2e`가 초록이고
   `grep -n "defaultModel" renderer/components/RunPanel.tsx`가 비어 있지 않다.

2. **탭 껍데기** — `SettingsPanel`을 탭 넷(`실행`·`앱`·`repo`·`정보`)으로 나눈다. 기존 절
   둘(실행 기본값·CLI 경로)은 `실행` 탭으로, 글로벌 asset 경로는 `앱` 탭으로 간다. 각 탭은
   자기 범위를 한 문장으로 밝힌다(FR-2). **초안 state는 `SettingsPanel`에 그대로 둔다.**
   **완료 확인**: 글로벌 경로를 고치다 다른 탭에 갔다 돌아오면 **고치던 값이 그대로다.**
   기존 `SettingsPanel.test.tsx`는 탭을 먼저 고르는 것 외에 단언을 바꾸지 않는다.

3. **`앱` 탭에 동시 실행 상한** — `useQueue` 스냅샷과 `onChangeLimit`을 prop으로 받아 그린다.
   **완료 확인**: 상한을 바꾸면 `onChangeLimit`이 불리고, 실패하면 값이 되돌아가며 메시지가
   뜬다. 도크의 슬롯 표시기와 **같은 숫자**를 보여준다.

4. **`repo.update`와 `asset.movePathPrefix`** — 저장소 둘. `movePathPrefix`는 **그 repo의
   행만** 옮긴다. **글로벌 행은 `repo_id`가 NULL이라 `eq(asset.repoId, null)`로는 잡히지도
   제외되지도 않는다** — `isNull`/`eq`를 명시적으로 갈라 쓴다(CLAUDE.md의 실제 함정).
   **완료 확인**: repo A의 asset만 새 접두사를 갖고 **글로벌 asset의 `file_path`는 한 글자도
   바뀌지 않는다.** 새 경로에 같은 `file_path`가 있으면 유니크 인덱스에 걸려 **트랜잭션
   전체가 되돌아간다** — 되돌아간 뒤 `repo.path`도 옛 값이다.

5. **core 표면** — `repos.update`(경로가 바뀌면 치환 → `assetService.scanRepo`), `paths()`.
   **완료 확인**: 경로를 바꾸면 그 repo의 asset이 **새 경로로 한 벌만** 남는다. 이름만 바꿀
   때는 재스캔하지 않는다.

6. **IPC 왕복** — `reposUpdate`·`appInfo`·`appReveal`. `appReveal`은 `'data' | 'logs'` 외의
   값을 **거부한다.** **완료 확인**: `grep -rn "from 'electron'" core/`가 비어 있고, 핸들러
   본문이 core 호출 한 줄이다. `appReveal('C:\\')` 같은 호출이 거부된다.

7. **`repo` 탭** — 목록과 편집. 저장 전에 경로 존재를 확인하고, **경로를 바꾸면 그 repo로
   이어가던 옛 대화가 다른 디렉토리를 가리키게 된다는 경고**를 함께 보여준다(spec 확인 필요
   항목). **완료 확인**: 없는 경로를 넣으면 저장이 거부되고 이유가 보이며 입력이 남는다.
   성공하면 `refreshRepos`가 불린다.

8. **`정보` 탭** — MCP 상태·포트, DB 경로, 로그 경로, 앱 버전, 열기 버튼 둘. **완료 확인**:
   `state: 'failed'`면 그 메시지가 그대로 보이고, 버튼 둘이 각각 `'data'`·`'logs'`로 부른다.

9. **`App.tsx` 추가 배선** — `repos`·`refreshRepos`·`queue`·`onChangeLimit`·`mcpStatus`를
   내려보낸다(`workspaces`·`workspaceId`·`onWorkspaceSaved`는 이미 있다). **완료 확인**:
   추가한 prop을 하나씩 지웠을 때 `App.test.tsx`가 **각각 실패한다.**

10. **`e2e/settings.e2e.ts`** — **완료 확인**: (수용 기준 5) repo 경로를 바꾼 뒤 asset 목록이
    **두 벌로 늘지 않는다.** (8) `앱` 탭에서 상한을 바꾸면 도크의 슬롯 표시기가 같은 값을
    보여준다. 탭을 옮겼다 돌아와도 입력이 남아 있다. 수용 기준 2는
    `e2e/workspace-defaults.e2e.ts`가 이미 덮는다 — 다시 쓰지 않는다.

11. **문서** — `docs/windows-setup.md` §4에서 repo 경로 SQL을 지우고 설정 화면 안내로 바꾼다.
    `CLAUDE.md`에 "repo 경로를 바꾸면 asset의 `file_path`가 전부 달라진다" 한 줄을 더한다.
    **완료 확인**: §4에 `UPDATE repo` 문자열이 남아 있지 않다.

## 리스크

| 리스크 | 영향 | 완화 방법 |
| --- | --- | --- |
| 탭을 쪼개며 초안 state를 자식으로 내린다 | 탭을 옮기면 입력이 사라진다 — FR-11이 지키려던 바로 그 약속 | 2단계가 "갔다 와도 그대로"를 단언한다. state는 `SettingsPanel`에 남긴다 |
| `eq(asset.repoId, null)`로 글로벌을 다룬다 | SQL에서 `repo_id = NULL`은 절대 참이 아니다 — 치환이 글로벌을 끌고 가거나 아무것도 안 한다 | 4단계가 글로벌 `file_path` 불변을 단언한다 |
| 경로 치환과 `repo.path` 갱신이 따로 커밋된다 | 절반만 반영돼 목록이 두 벌이 된다 | 한 트랜잭션. 4단계의 롤백 테스트 |
| `App.tsx`의 prop 한 줄이 무방비로 남는다 | 탭은 보이는데 값이 안 바뀐다. 테스트는 초록 | 9단계의 변이 검증. **3a·3b가 새어나간 자리가 예외 없이 여기였다** |
| 기존 `SettingsPanel.test.tsx`(383줄)를 탭 때문에 크게 고친다 | 방금 검증된 것이 흔들린다 | 2단계는 **탭 선택 한 줄만** 더한다. 단언을 고치기 시작하면 멈추고 껍데기 설계를 다시 본다 |
| repo 경로를 바꾼 뒤 옛 대화를 이어간다 | `--resume` 세션이 다른 디렉토리를 가리킨다. 실측되지 않았다 | 7단계가 경고를 띄운다. 실제 동작은 마지막 수동 확인에서 처음 관측한다 |
| `appReveal`이 임의 경로를 연다 | 렌더러가 파일 탐색기로 아무 데나 열 수 있다 | 6단계가 `'data' \| 'logs'` 외 거부를 테스트한다 |
| workspace가 하나뿐이라 범위 구분이 안 잡힌다 | "workspace마다 다르다"가 무방비 | `workspace-defaults.e2e.ts`가 이미 다루는지 먼저 보고, 없으면 테스트에서 둘을 만든다 |

## 완료 증명

- [x] `pnpm test` — **963 통과 / 28 건너뜀** (기준선 921에서 42개 늘었다)
- [x] `pnpm typecheck` — 오류 없음
- [x] `pnpm lint` — 오류 없음
- [x] `pnpm test:e2e` — **21 통과 / 2 건너뜀**, `settings.e2e.ts` 3개 포함 (기준선 18)
- [x] `grep -rn "from 'electron'" core/` — 출력 없음
- [x] `grep -rn "window.oneDesk" renderer/ | grep -v main.tsx` — 출력 없음
- [x] `ls drizzle/*.sql | wc -l` — 6, 작업 전과 같다 (마이그레이션 없음)
- [x] `grep -n "UPDATE repo" docs/windows-setup.md` — 출력 없음
- [x] **변이 검증** — 아래 여섯을 하나씩 망가뜨려 각각 실패하는 테스트가 있는지 확인했다
  - [x] 탭 전환이 초안을 보존하는 구조 — 탭 클릭이 입력을 지우게 하자 2개 실패
  - [x] `movePathPrefix`의 `repo_id` 조건 — 지우자 글로벌 불변·경계 테스트 2개 실패
  - [x] 치환 + 경로 갱신의 트랜잭션 경계 — 트랜잭션을 빼자 롤백 테스트 실패
  - [x] `repos.update`가 경로 변경 시 재스캔을 부르는 줄 — 지우자 lastSeenAt 단언 실패
  - [x] `appReveal`의 대상 검증 — 기본 분기를 통과시키자 실패
  - [x] `App.tsx`가 새로 내려보내는 prop **각각** — `queue`·`repos`(SettingsPanel 줄만)·`mcpStatus`는 끊어서, `onChangeLimit`·`refreshRepos`는 필수 prop이라 typecheck가 막는 것으로. 셋 다 배선 전에 red를 먼저 봤다
- [ ] **수동 확인** — 빌드된 앱에서 repo 경로를 실제로 바꾸고, asset 목록이 한 벌인지와 그
      repo로 실행이 도는지 본다. 경로 변경 후 **옛 대화 이어가기**가 어떻게 되는지도 여기서
      처음 관측한다

## 계획 이탈 기록

- **2026-09-19.** 초판의 1·2·5·8·11(일부) 단계가 다른 작업에서 먼저 구현돼 들어왔다.
  계획을 그 상태에 맞춰 다시 썼고, spec의 FR-11(저장 방식)을 개정했다. 위 개정 기록 참고.
- **9단계(App 배선)를 따로 두지 않았다.** prop마다 그것을 쓰는 단계(3·7·8)에서 배선
  테스트를 함께 썼고, 각 prop을 끊어 App.test가 실제로 실패하는 것을 그 자리에서
  확인했다. 한 번에 몰아서 하면 어느 prop이 무방비인지 흐려진다.
- **경로 치환은 `asset.ts`의 exported 함수 `moveAssetPathPrefix(runner, input)`이고,
  트랜잭션은 `repo.update`가 쥔다.** 저장소 하나가 트랜잭션을 여는 것이 이 코드베이스의
  패턴(`issue.ts`가 태그 테이블까지 한 트랜잭션에서 쓴다)이라 그 모양을 따랐다. 저장소
  객체에는 자기 트랜잭션으로 감싼 `movePathPrefix`도 남겨 단독 테스트가 가능하다.
- **`appReveal`의 대상 검증은 `core/app/reveal.ts`의 순수 함수로 뺐다.** electron IPC에는
  테스트가 없어 검증을 main에 두면 아무것도 고정하지 못한다. `core/editor/vscodeUrl.ts`와
  같은 구조다.
- **`AppInfo`에 `dataDir`가 들어갔다.** spec은 DB 파일과 로그 디렉토리만 적었으나
  "데이터 폴더 열기"가 dataDir를 열므로 core의 `paths()`가 셋을 준다.
- **e2e는 repo 디렉토리를 `renameSync`로 옮기지 않는다.** Windows에서 `EBUSY`가 난다 —
  앱이 그 디렉토리에 핸들을 쥔다(CLAUDE.md의 "열린 핸들이 있는 파일을 지우지 못한다"와
  같은 함정). 대신 새 디렉토리에 같은 skill을 두고 경로를 그리로 바꾼다. FR-9가
  검증하려는 것("행이 옮겨졌지 새로 생기지 않았다")은 그대로 잡힌다.
- **`e2e/asset.e2e.ts`가 앱 탭을 먼저 연다.** 글로벌 경로가 앱 탭으로 갔으므로 클릭 한
  줄이 더해졌다. 단언은 그대로다.
- **`docs/windows-setup.md` §3도 고쳤다.** 계획은 §4만 적었으나 §3이 "CLI 경로에 편집
  UI가 없다"고 적어 둔 문장이 이미 틀려 있었다(`e0ce778`).
