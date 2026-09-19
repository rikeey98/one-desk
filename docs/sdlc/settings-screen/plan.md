# Plan: 탭 기반 설정 화면

- 출처: `intent.md`, `spec.md` (2026-09-19 승인)
- 작성자: 권용현
- 상태: 승인됨 (2026-09-19)
- 작성일: 2026-09-19

## 전제

**task_926353a6(기본 모델 배선)이 먼저 병합돼 있어야 한다.** spec의 확인 필요 항목에서
정한 순서다. 그 작업이 `RunPanel`이 `workspace.defaultModel*`을 초기값으로 읽게 만들고,
이 계획은 그 값을 **고치는 화면**만 만든다. 병합 전에 시작하면 수용 기준 2의 절반(기본
모델)을 검증할 수 없고, 두 작업이 같은 `RunPanel.tsx`에서 충돌한다.

## spec에서 다듬은 것

코드를 읽으며 드러난 넷이다. spec의 결정을 뒤집지 않고 모양만 맞춘다.

1. **`SettingsPanel`은 훅을 스스로 부르지 않는다.** spec은 "각 탭은 자기 데이터만 읽는다"로
   적었으나, 이 앱은 `useWorkspaces`·`useRepos`·`useQueue`를 **`App.tsx`에서 한 번만 부르고
   prop으로 내려보낸다.** 자식이 각자 부르다 실제 결함이 두 번 났다(`App.tsx:36`·`:51`,
   커밋 fbcd0e6 — repo를 등록해도 한쪽만 갱신되고, 인박스가 방금 만든 workspace를
   "(사라진 workspace)"로 그렸다). 설정 화면도 같은 규칙을 따른다.
2. **상한은 `App`이 이미 들고 있는 것을 그대로 쓴다.** `useQueue`의 스냅샷과
   `onChangeLimit`을 `앱` 탭에 내려보낸다. 설정 화면이 자기 인스턴스를 만들면 도크와
   설정이 서로의 변경을 모른다 — FR-7이 요구하는 "한쪽을 바꾸면 다른 쪽이 따라온다"가
   이 배선으로만 성립한다.
3. **경로 치환은 asset *저장소*에 둔다.** `movePathPrefix`는 트랜잭션과 유니크 인덱스를
   다루므로 서비스가 아니라 저장소의 관심사다. 서비스(`core/assets/service.ts`)는 그 뒤에
   `scanRepo`를 부르는 역할만 한다.
4. **`app.info()`는 core가 조립하지 않는다.** core는 `dataDir`를 알지만 앱 버전은 electron의
   것이다(`app.getVersion()`). core에 `paths()`를 두고 **main이 버전을 더해** 돌려준다 —
   경계 규칙 1이 이것을 강제한다.

## 변경되는 파일

| 파일 | 신규/수정 | 변경 내용 |
| --- | --- | --- |
| `core/db/repositories/workspace.ts` | 수정 | `updateDefaults(id, patch)`. `rename`은 건드리지 않는다 |
| `core/db/repositories/workspace.test.ts` | 수정 | 부분 갱신, `updatedAt` 상승, 없는 id |
| `core/db/repositories/repo.ts` | 수정 | `update(id, patch)` — 이름·설명·경로 |
| `core/db/repositories/repo.test.ts` | 수정 | 경로 변경, 빈 경로 거부 |
| `core/db/repositories/asset.ts` | 수정 | `movePathPrefix({ workspaceId, repoId, from, to })` 트랜잭션 |
| `core/db/repositories/asset.test.ts` | 수정 | 접두사 치환, 글로벌(`repo_id IS NULL`) 제외, 충돌 롤백 |
| `core/index.ts` | 수정 | `workspaces.updateDefaults`, `repos.update`, `paths()` 표면 |
| `core/index.test.ts` | 수정 | 배선 + 경로 변경이 재스캔까지 가는지 |
| `shared/models.ts` | 수정 | `UpdateWorkspaceDefaultsInput`, `UpdateRepoInput`, `AppInfo` |
| `shared/channels.ts` | 수정 | `workspacesUpdateDefaults`, `reposUpdate`, `appInfo`, `appReveal` |
| `shared/client.ts` | 수정 | 같은 모양의 메서드 넷 |
| `electron/ipc/workspaces.ts` | 수정 | 핸들러 하나. core 호출만 |
| `electron/ipc/repos.ts` | 수정 | 핸들러 하나 |
| `electron/ipc/app.ts` | 신규 | `appInfo`(버전 합성), `appReveal`(`'data' \| 'logs'`만) |
| `electron/ipc/index.ts` | 수정 | `registerAppHandlers` 한 줄 |
| `electron/preload.ts` | 수정 | 브리지 넷 |
| `renderer/components/SettingsPanel.tsx` | 수정 | 탭 넷의 껍데기로. 기존 내용은 `앱` 탭으로 |
| `renderer/components/SettingsPanel.test.tsx` | 수정 | **'저장' 버튼이 사라진다** — 즉시 커밋으로 고쳐 쓴다 |
| `renderer/components/settings/AppTab.tsx` | 신규 | 글로벌 경로 둘 + 동시 실행 상한 |
| `renderer/components/settings/AppTab.test.tsx` | 신규 | 커밋·실패·상한 반영 |
| `renderer/components/settings/RunDefaultsTab.tsx` | 신규 | 기본값 다섯 + 권한 확인 절차 |
| `renderer/components/settings/RunDefaultsTab.test.tsx` | 신규 | FR-3·FR-4·FR-5·FR-6 |
| `renderer/components/settings/RepoTab.tsx` | 신규 | repo 목록과 경로·이름·설명 편집 |
| `renderer/components/settings/RepoTab.test.tsx` | 신규 | 경로 저장, 존재하지 않는 경로 |
| `renderer/components/settings/InfoTab.tsx` | 신규 | MCP·경로·버전, 열기 버튼 둘 |
| `renderer/components/settings/InfoTab.test.tsx` | 신규 | `failed` 메시지 표시 |
| `renderer/components/settings/CommitField.tsx` | 신규 | Enter·blur 커밋, Esc 취소 (FR-11) |
| `renderer/components/settings/CommitField.test.tsx` | 신규 | 이중 커밋 방지 포함 |
| `renderer/App.tsx` | 수정 | `SettingsPanel`에 prop 내려보내기 |
| `renderer/App.test.tsx` | 수정 | **배선 테스트** — prop 한 줄을 지우면 실패해야 한다 |
| `e2e/settings.e2e.ts` | 신규 | 수용 기준 2·5·8 |
| `e2e/asset.e2e.ts` | 수정 | '저장' 클릭(82행)이 사라진다 |
| `docs/windows-setup.md` | 수정 | §4의 SQL 안내를 설정 화면 안내로 |
| `CLAUDE.md` | 수정 | repo 경로 변경과 asset 동일성 함정 한 줄 |

**마이그레이션 없음** — 컬럼과 `app_setting` 키가 이미 전부 있다.

## 작업 순서

1. **전제 확인** — `RunPanel`이 `workspace.defaultModelClaude`/`defaultModelOpencode`를
   초기값으로 읽는지 본다. **완료 확인**: `grep -n "defaultModel" renderer/components/RunPanel.tsx`가
   비어 있지 않다. 비어 있으면 **여기서 멈추고** task_926353a6을 먼저 병합한다.

2. **`workspace.updateDefaults`** — 넘어온 필드만 고치고 `updatedAt`을 올린다. 빈 문자열은
   `null`로 정규화한다(경로·모델을 비우면 자동 탐색/CLI 기본값으로 돌아간다 — FR-5).
   **완료 확인**: 모델만 넘기면 권한이 그대로고, 경로에 `''`를 넣으면 `null`이 저장되며,
   `updatedAt`이 **이전 값보다 크다**. 없는 id는 던진다.

3. **`repo.update`와 `asset.movePathPrefix`** — 저장소 둘. `movePathPrefix`는 **그 repo의
   행만** 옮긴다. **글로벌 행은 `repo_id`가 NULL이라 `eq(asset.repoId, null)`로는 잡히지도
   제외되지도 않는다** — `isNull`/`eq`를 명시적으로 갈라 쓴다(CLAUDE.md의 실제 함정).
   **완료 확인**: repo A의 asset만 새 접두사를 갖고 **글로벌 asset의 `file_path`는 한 글자도
   바뀌지 않는다.** 새 경로에 같은 `file_path`가 이미 있으면 **유니크 인덱스에 걸려
   트랜잭션 전체가 되돌아간다** — 되돌아간 뒤 `repo.path`도 옛 값이다.

4. **core 표면** — `workspaces.updateDefaults`, `repos.update`(경로가 바뀌면 치환 →
   `assetService.scanRepo` 순서로), `paths()`. **완료 확인**: 경로를 바꾸면 그 repo의
   asset이 **새 경로로 한 벌만** 남는다(두 벌이 되면 실패). `repos.update`가 이름만 바꿀
   때는 재스캔하지 않는다.

5. **IPC 왕복** — 채널 넷, 클라이언트 타입, preload, `ipc/app.ts`. `appReveal`은
   `'data' | 'logs'` 외의 값을 **거부한다.** **완료 확인**: `grep -rn "from 'electron'" core/`가
   비어 있고, 핸들러 본문이 core 호출 한 줄이다. `appReveal('C:\\')` 같은 호출이 거부된다.

6. **`CommitField`** — Enter·blur 커밋, Esc 취소. **`SlotIndicator`의 `suppressBlurRef`
   패턴을 그대로 가져온다** — Esc로 언마운트될 때 따라오는 네이티브 blur가 취소한 값을
   되살리는 실제 함정이다(`SlotIndicator.tsx:16-21` 주석). **완료 확인**: Esc 뒤에 커밋이
   **불리지 않고**, Enter 뒤에도 **한 번만** 불린다. 값이 그대로면 아예 부르지 않는다.

7. **`앱` 탭** — 기존 글로벌 경로 둘을 `CommitField`로 옮기고 상한 필드를 더한다.
   **완료 확인**: `SettingsPanel.test.tsx`의 기존 다섯 테스트를 즉시 커밋 모양으로 고쳐
   통과시킨다. 상한을 바꾸면 `onChangeLimit`이 불리고, 실패하면 값이 되돌아가며 메시지가 뜬다.

8. **`실행` 탭** — 기본 agent·모델 둘·권한·실행 파일 경로 둘. 권한을 `full`로 올릴 때만
   `ConfirmButton` 패턴으로 한 번 더 받는다. **완료 확인**: 확인하지 않으면
   `updateDefaults`가 **불리지 않는다.** `full`에서 `edit`으로 내리는 것은 확인 없이 바로
   저장된다. workspace가 없으면 안내만 보이고 필드가 없다(FR-13).

9. **`repo` 탭** — 목록과 편집. 저장 전에 경로 존재를 확인한다. **완료 확인**: 없는 경로를
   넣으면 저장이 거부되고 이유가 보이며 입력이 남는다(FR-12). 경로를 바꾸면 성공 후
   `refreshRepos`가 불린다.

10. **`정보` 탭** — MCP 상태·포트, DB 경로, 로그 경로, 버전, 열기 버튼 둘. **완료 확인**:
    `state: 'failed'`면 그 메시지가 그대로 보이고, 버튼 둘이 각각 `'data'`·`'logs'`로
    부른다.

11. **`App.tsx` 배선** — `workspaces`·`workspaceId`·`repos`·`refreshRepos`·`queue`·
    `onChangeLimit`·`mcpStatus`를 `SettingsPanel`에 내려보낸다. **완료 확인**: 각 prop을
    하나씩 지웠을 때 `App.test.tsx`가 **각각 실패한다.** 이것이 3a·3b 리뷰가 두 번 놓친
    자리다(CLAUDE.md).

12. **`e2e/settings.e2e.ts`** — 화면을 실제로 클릭한다. **완료 확인**: (수용 기준 2) 기본
    agent를 OpenCode로 바꾸고 실행 패널을 열면 드롭다운이 OpenCode다. (5) repo 경로를 바꾼
    뒤 asset 목록이 **두 벌로 늘지 않는다.** (8) `앱` 탭에서 상한을 바꾸면 도크의 슬롯
    표시기가 같은 값을 보여준다. 실행 버튼은 `{ name: '실행', exact: true }`로 잡는다.

13. **문서** — `docs/windows-setup.md` §4에서 repo 경로·CLI 경로 SQL을 지우고 설정 화면
    안내로 바꾼다. `CLAUDE.md`에 "repo 경로를 바꾸면 asset의 `file_path`가 전부 달라진다"
    한 줄을 더한다. **완료 확인**: §4에 `UPDATE repo` 문자열이 남아 있지 않다.

## 리스크

| 리스크 | 영향 | 완화 방법 |
| --- | --- | --- |
| task_926353a6이 아직 안 들어왔는데 시작한다 | 기본 모델이 저장만 되고 아무 데도 안 쓰인다. 조용하다 | 1단계가 `grep`으로 먼저 막는다 |
| `eq(asset.repoId, null)`로 글로벌을 다룬다 | SQL에서 `repo_id = NULL`은 절대 참이 아니다 — 치환이 조용히 아무것도 안 하거나 글로벌까지 옮긴다 | 3단계가 글로벌 `file_path` 불변을 단언한다. CLAUDE.md에 같은 사고 기록이 있다 |
| 경로 치환과 `repo.path` 갱신이 따로 커밋된다 | 절반만 반영돼 목록이 두 벌이 된다 | 한 트랜잭션. 3단계의 롤백 테스트가 고정한다 |
| blur 커밋이 두 번 실행된다 | Esc가 취소한 값이 되살아난다 | 6단계가 `SlotIndicator`의 검증된 패턴을 그대로 쓴다 |
| `App.tsx`의 prop 한 줄이 무방비로 남는다 | 탭은 보이는데 값이 안 바뀐다. 테스트는 초록 | 11단계의 변이 검증. **3a·3b가 새어나간 자리가 예외 없이 여기였다** |
| 저장 버튼 제거로 기존 테스트가 깨진다 | `SettingsPanel.test.tsx` 5개와 `e2e/asset.e2e.ts:82` | **의도된 비용이다**(spec 확인 필요 항목). 7단계에서 함께 고친다 |
| workspace가 하나뿐이라 범위 구분이 안 잡힌다 | "workspace마다 다르다"가 무방비 | 테스트에서 둘을 만들어 번갈아 고른다 |
| repo 경로를 바꾼 뒤 옛 대화를 이어간다 | `--resume` 세션이 다른 디렉토리를 가리킨다. 실측되지 않았다 | 9단계에 경고 문구를 넣는다. 실제 동작 확인은 별도 실측으로 남긴다 |
| `appReveal`이 임의 경로를 연다 | 렌더러가 파일 탐색기로 아무 데나 열 수 있다 | 5단계가 `'data' \| 'logs'` 외를 거부하는 것을 테스트한다 |
| 즉시 커밋이 매 글자마다 저장한다 | IPC 폭주 | 커밋은 Enter·blur에서만. `useDebouncedSave`를 쓰지 않는다 |

## 완료 증명

- [ ] `pnpm test` — 전부 초록
- [ ] `pnpm typecheck` — 오류 없음
- [ ] `pnpm lint` — 오류 없음
- [ ] `pnpm test:e2e` — `settings.e2e.ts` 포함 전부 통과
- [ ] `grep -rn "from 'electron'" core/` — 출력 없음
- [ ] `grep -rn "window.oneDesk" renderer/ | grep -v main.tsx` — 출력 없음
- [ ] `ls drizzle/*.sql | wc -l` — 작업 전과 같은 수 (마이그레이션 없음)
- [ ] `grep -n "UPDATE repo" docs/windows-setup.md` — 출력 없음
- [ ] **변이 검증** — 아래 여덟을 하나씩 망가뜨려 각각 실패하는 테스트가 있는지 확인한다
  - [ ] `updateDefaults`의 빈 문자열 → `null` 정규화
  - [ ] `movePathPrefix`의 `repo_id` 조건 (지우면 글로벌까지 옮겨져야 실패)
  - [ ] 치환+경로 갱신의 트랜잭션 경계
  - [ ] `repos.update`가 경로 변경 시 재스캔을 부르는 줄
  - [ ] 권한 `full` 확인 절차 (지우면 바로 저장돼야 실패)
  - [ ] `CommitField`의 Esc 취소
  - [ ] `appReveal`의 대상 검증
  - [ ] `App.tsx`가 `SettingsPanel`에 내려보내는 prop **각각**
- [ ] **수동 확인** — 빌드된 앱에서 repo 경로를 실제로 바꾸고, asset 목록이 한 벌인지와
      그 repo로 실행이 도는지 본다. 경로 변경 후 **옛 대화 이어가기**가 어떻게 되는지도
      여기서 처음 관측한다(리스크 표의 미실측 항목)

## 계획 이탈 기록

(구현하며 계획과 달라진 것을 여기 적는다)
