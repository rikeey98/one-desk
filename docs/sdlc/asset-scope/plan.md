# Plan: asset 목록 범위 확장

- 출처: `intent.md`, `spec.md` (2026-09-09 승인)
- 작성자: 권용현
- 상태: 승인됨
- 작성일: 2026-09-09

## 변경되는 파일

| 파일 | 신규/수정 | 변경 내용 |
| --- | --- | --- |
| `core/db/schema.ts` | 수정 | 유니크 인덱스를 `(workspace_id, repo_id, file_path)`에서 `(workspace_id, file_path)`로 바꾼다 |
| `drizzle/0005_*.sql` | 신규 | 생성된 마이그레이션. **중복 행 정리 SQL을 손으로 앞에 덧붙인다** |
| `core/db/migrations.test.ts` | 수정 | 0005의 인덱스 교체와 중복 정리를 검증한다 |
| `core/assets/scan.ts` | 수정 | 디렉토리 하나를 두 패턴으로 훑는 `scanDir(dir)`를 내보내고, `scanRepo`가 그것을 쓰게 한다 |
| `core/assets/scan.test.ts` | 수정 | `scanDir`의 두 패턴과 빈/없는 디렉토리 |
| `core/db/repositories/setting.ts` | 수정 | 글로벌 경로 두 키의 접근자와 기본값 |
| `core/db/repositories/setting.test.ts` | 수정 | 저장·조회·기본값·빈 값 |
| `core/db/repositories/asset.ts` | 수정 | `upsertDiscovered`의 `repoId`를 nullable로, **조회 키를 `(workspaceId, filePath)`로** 바꾼다. `list`가 `repoId` 필터를 받는다 |
| `core/db/repositories/asset.test.ts` | 수정 | 글로벌 upsert 중복 방지, repo 필터 |
| `core/db/repositories/issue.test.ts` | 수정 | 여러 repo에 걸친 이슈가 각 repo 필터에서 모두 보이는지 (회귀 고정) |
| `core/db/repositories/memo.test.ts` | 수정 | 위와 같음 |
| `core/assets/service.ts` | 수정 | 글로벌 루트를 받아 함께 훑는다 |
| `core/assets/service.test.ts` | 수정 | 글로벌 스캔, 두 번 돌려도 안 늘어남 |
| `core/index.ts` | 수정 | `CoreOptions.homeDir` 추가, 설정 접근자 노출, run 완료 후 재스캔 |
| `core/index.test.ts` | 수정 | 글로벌 경로가 실제로 훑히는지, run 후 재스캔 |
| `electron/main.ts` | 수정 | `homeDir: app.getPath('home')`를 넘긴다 |
| `shared/channels.ts` | 수정 | `settings:getGlobalRoots` · `settings:setGlobalRoots` |
| `shared/client.ts` | 수정 | `settings` 표면과 `GlobalRoots` 타입 |
| `shared/models.ts` | 수정 | `GlobalRoots` 타입, `ListAssetQuery`에 `repoId` |
| `electron/ipc/settings.ts` | 신규 | 얇은 핸들러 둘 |
| `electron/ipc/index.ts` | 수정 | 등록 한 줄 |
| `electron/preload.ts` | 수정 | 브리지 |
| `renderer/hooks/useAssets.ts` | 수정 | `repoId`를 받아 조회에 싣는다 |
| `renderer/components/AssetPanel.tsx` | 수정 | `repoId` prop, 출처 라벨(`글로벌`/repo 이름/`앱에서 작성`) |
| `renderer/components/AssetPanel.test.tsx` | 수정 | 필터와 라벨 |
| `renderer/components/SettingsPanel.tsx` | 신규 | 글로벌 경로 편집 화면 |
| `renderer/components/SettingsPanel.test.tsx` | 신규 | 저장·오류·기본값 |
| `renderer/components/Sidebar.tsx` | 수정 | 하단에 설정 링크, `view` 유니온에 `'settings'` |
| `renderer/components/Sidebar.test.tsx` | 수정 | 링크가 `onSelectSettings`를 부른다 |
| `renderer/App.tsx` | 수정 | `view`에 `'settings'`, 설정 화면 전환, `AssetPanel`에 `repoId` |
| `renderer/App.test.tsx` | 수정 | 설정 화면 전환, asset repo 필터 배선 |
| `e2e/asset.e2e.ts` | 수정 | 글로벌 경로를 임시 디렉토리로 설정해 목록에 뜨는지 |
| `docs/superpowers/specs/2026-09-07-asset-scan-design.md` | 수정 | §3-1·§3-3에 개정 주석 |
| `CLAUDE.md` | 수정 | 새로 생긴 함정 기록 |

## 작업 순서

각 단계는 실패하는 테스트 → 구현 → 통과 → 커밋 순서로 간다. **회귀 테스트를 더할 때는 대상
코드를 잠시 망가뜨려 그 테스트가 실제로 빨간불이 되는지 확인한다**(CLAUDE.md).

1. **동일성 키 교체 (마이그레이션 0005)** — `schema.ts`의 인덱스를 바꾸고 `pnpm db:generate`.
   생성된 SQL 맨 앞에 중복 정리를 손으로 넣는다.
   ```sql
   DELETE FROM asset WHERE file_path IS NOT NULL AND id NOT IN (
     SELECT id FROM asset a WHERE a.file_path IS NOT NULL
     AND a.created_at = (SELECT MIN(b.created_at) FROM asset b
                         WHERE b.workspace_id = a.workspace_id AND b.file_path = a.file_path)
     GROUP BY a.workspace_id, a.file_path
   );
   ```
   **완료 확인**: 같은 `(workspace, file_path)`를 두 번 INSERT하면 UNIQUE로 거부되고,
   `repo_id`가 다른 두 행도 거부된다. `file_path`가 NULL인 `authored`는 여럿 들어간다.

2. **`scanDir` 추출** — `scan.ts`에 디렉토리 하나를 두 패턴으로 훑는 함수를 만든다:
   하위 디렉토리의 `SKILL.md` → `skill`, 최상위 `*.md` → `agent`. `scanRepo`는 세 경로에
   대해 이것을 부르는 얇은 껍데기가 된다.
   **완료 확인**: `~/.claude/skills` 모양(하위 디렉토리+SKILL.md)과 `~/.claude/agents`
   모양(최상위 *.md)을 각각 임시 디렉토리로 만들어 넣으면 기대한 kind로 나온다.
   기존 `scanRepo` 테스트 6개가 그대로 초록이다.

3. **설정 저장소** — `setting.ts`에 두 키의 접근자를 더한다.
   `assets.globalRoots.claude`(기본 `<home>/.claude/skills`, `<home>/.claude/agents`),
   `assets.globalRoots.opencode`(기본 `<home>/.config/opencode/agent`). 값은 줄바꿈으로
   구분한 목록이고, 빈 값이면 기본값을 돌려준다. **기본값 계산에 홈 경로가 필요하므로
   저장소 생성 시 인자로 받는다** — `core/`가 홈을 스스로 알지 않는다(NFR-2).

   시그니처가 `createSettingRepository(db)`에서 `createSettingRepository(db, homeDir)`로
   바뀐다. **기존 호출부를 전부 고쳐야 한다** — `core/index.ts` 하나와
   `core/db/repositories/setting.test.ts`의 `beforeEach`다. 두 번째 인자를 선택적으로
   두지 않는다: 빠뜨리면 글로벌 경로가 조용히 비어 목록이 비는데, 그게 정확히 이번에
   고치려는 증상이다.
   **완료 확인**: 저장 후 조회하면 그대로 나오고, 저장한 적 없으면 주어진 홈 기준
   기본값이 나온다. 홈을 임시 디렉토리로 주면 그 아래 경로가 나온다.

4. **저장소의 조회 키와 필터** — `upsertDiscovered`의 `repoId`를 `string | null`로 바꾸고,
   **기존 행 조회를 `(workspaceId, filePath)`로 바꾼다.** 지금은 `eq(asset.repoId, ...)`인데
   `repoId`가 null이면 SQL의 `repo_id = NULL`이 되어 **절대 일치하지 않는다** — 그대로 두면
   글로벌이 매번 INSERT를 시도해 1단계에서 만든 유니크 인덱스에 걸린다.
   `list`에 `repoId?: string | null` 필터를 더한다: 값이 있으면 `repo_id IS NULL OR repo_id = ?`,
   없으면 전부.
   **완료 확인**: 글로벌 asset을 두 번 upsert해도 행이 하나다. repo를 지정해 조회하면
   글로벌 + 그 repo + `authored`만 나온다.

5. **서비스가 글로벌을 훑는다** — `createAssetService`가 글로벌 루트 목록을 받고,
   `scanWorkspace`/`scanAll`이 repo들에 더해 글로벌 루트도 훑어 `repoId: null`로 넣는다.
   **완료 확인**: 임시 디렉토리를 글로벌 루트로 준 뒤 `scanWorkspace`를 두 번 부르면
   그 skill이 하나만 남는다.

6. **core 배선** — `CoreOptions.homeDir`를 더하고(생략 시 테스트가 임시 경로를 준다),
   설정 저장소·asset 서비스에 넘긴다. `core.settings.getGlobalRoots/setGlobalRoots`를
   노출한다. **`setGlobalRoots`는 저장한 뒤 `scanAll()`을 부른다** — 설정 화면은 본문을
   차지하므로 저장 직후 사용자가 asset 목록을 보고 있지 않다. 저장만 하고 끝내면
   workspace로 돌아가 새로고침을 눌러야 반영되는데, 그 한 단계를 사람이 기억해야 할
   이유가 없다. `scanAll`은 이미 부팅이 쓰는 함수이고 디렉토리 몇 개를 읽을 뿐이다.
   `onRunUpdate`에서 run이 끝났을 때 그 workspace를 다시 훑는다(FR-7).
   **완료 확인**: `createCore`에 임시 홈을 주고 그 아래 skill을 심으면 부팅 후 목록에 뜬다.
   가짜 CLI 실행이 끝나면 실행 중 만든 파일이 목록에 뜬다.

7. **IPC와 preload** — 채널 둘, 클라이언트 표면, 얇은 핸들러, 브리지.
   **완료 확인**: `pnpm typecheck`가 통과하고 렌더러에서 `client.settings.getGlobalRoots()`가
   타입으로 보인다.

8. **설정 화면** — `SettingsPanel`을 만든다. 두 개의 여러 줄 입력(claude / opencode)과
   저장 버튼, 저장 실패 시 `role="alert"`. `Sidebar` 하단(MCP 상태 줄 위)에 설정 링크를
   두고 `view` 유니온에 `'settings'`를 더한다. `App`이 `view === 'settings'`일 때 본문을
   설정으로 바꾼다 — 인박스 전환과 같은 방식이다.
   **완료 확인**: 사이드바에서 설정을 누르면 본문이 설정으로 바뀌고, workspace를 누르면
   돌아온다. 값을 바꿔 저장하면 `setGlobalRoots`가 그 값으로 불린다. 저장 후 workspace로
   돌아가면 새로고침을 누르지 않아도 바뀐 경로의 결과가 보인다.

9. **패널의 필터와 라벨** — `useAssets(workspaceId, repoKey, repoId)`, `AssetPanel`에
   `repoId`와 `repos`(이름 조회용)를 넘긴다. 각 줄에 출처를 보여준다 — `authored`면
   `앱에서 작성`, `repo_id`가 없으면 `글로벌`, 있으면 그 repo 이름.
   **완료 확인**: repo를 고르면 다른 repo의 asset이 사라지고 글로벌과 `authored`는 남는다.
   각 줄에 세 라벨 중 하나가 보인다.

10. **repo 필터 규칙을 고정한다** — FR-10의 절반은 이미 고정돼 있다:
    `memo.test.ts`의 "repo 필터는 공통 메모도 함께 반환한다"와 `issue.test.ts`의
    "repo 필터는 그 repo의 항목과 태그 없는 공통 항목을 함께 반환한다". **나머지 절반이
    비어 있다** — `issue.test.ts`의 두 repo 태그 테스트는 저장·조회만 보고 필터를 보지
    않는다. 이슈와 메모에 각각 하나씩 더한다: A·B에 태그된 항목을 만들고 A로 걸러도
    B로 걸러도 나오는지.
    **완료 확인**: `list`의 `or(inArray(...), notInArray(...))`에서 `inArray` 쪽을 지우면
    새 테스트가 빨간불이 된다.

11. **e2e** — 기존 `asset.e2e.ts`에 글로벌 경로 시나리오를 더한다. 임시 디렉토리에 skill을
    심고 설정 화면에서 그 경로를 넣은 뒤 새로고침하면 목록에 뜬다.
    **완료 확인**: `pnpm test:e2e`가 초록.

12. **문서** — `2026-09-07-asset-scan-design.md`의 §3-1(스캔 경로)과 §3-3(동일성 키)에
    "이 결정은 `docs/sdlc/asset-scope/spec.md`가 대체함" 주석을 덧붙인다. `CLAUDE.md`에
    새 함정을 적는다.
    **완료 확인**: 두 문서에 해당 문장이 있다.

## 리스크

| 리스크 | 영향 | 완화 방법 |
| --- | --- | --- |
| `upsertDiscovered`가 `repo_id = NULL`로 조회해 글로벌이 매번 INSERT를 시도한다 | 유니크 인덱스에 걸려 **스캔이 예외로 죽는다.** 부팅 스캔이면 목록이 통째로 안 채워진다 | 4단계에서 조회 키를 `(workspaceId, filePath)`로 바꾼다. 글로벌을 두 번 upsert하는 테스트가 이것을 고정한다 |
| 마이그레이션 0005가 기존 중복 행 때문에 실패한다 | **앱이 뜨지 않는다.** 마이그레이션은 부팅 경로다 | 인덱스 생성 전에 중복 정리 SQL을 넣는다. 중복이 있는 DB를 만들어 0004→0005를 태우는 테스트로 확인한다 |
| 부팅 스캔이 홈 디렉토리 전체를 훑어 느려진다 | 앱 기동 지연 | 훑는 것은 지정된 디렉토리의 **한 겹**뿐이다(하위 디렉토리의 SKILL.md와 최상위 *.md). 재귀하지 않는다 |
| 테스트가 개발자의 실제 홈을 훑어 결과가 사람마다 달라진다 | 로컬은 초록인데 CI에서 깨지거나 그 반대 | `homeDir`를 인자로 받아 테스트가 임시 디렉토리를 준다. `core/`에서 `os.homedir()`를 부르지 않는다 |
| 글로벌 asset이 workspace 수만큼 중복 저장된다 | 행 수 증가 | 의도한 선택이다(spec). 18개 × workspace 수는 무시할 만하다 |
| 설정 화면이 새 화면 개념이라 기존 화면 전환과 어긋난다 | UI 일관성 | 인박스 전환과 **같은 `view` 상태**를 쓴다. 새 라우팅을 만들지 않는다 |
| Windows 기본 경로가 틀리다 | 그 장비에서 목록이 빔 | spec의 "확인되지 않은 가정". FR-2의 설정으로 복구된다 |

## 완료 증명

- [ ] `pnpm test` — 전부 통과. 새로 더한 것: 0005 마이그레이션(인덱스·중복 정리),
      `scanDir` 두 패턴, 설정 저장소 기본값, 글로벌 upsert 중복 방지, repo 필터,
      서비스의 글로벌 스캔, core 배선, 설정 화면, 패널 필터·라벨, repo 필터 회귀 고정
- [ ] `pnpm typecheck` · `pnpm lint` — 통과
- [ ] `pnpm test:e2e` — 통과. 글로벌 경로 시나리오 포함
- [ ] `grep -rn "from 'electron'" core/` — 빈 출력
- [ ] `grep -rn "window.oneDesk" renderer/ | grep -v main.tsx` — 빈 출력
- [ ] **수동**: 앱을 띄워 `SKILLS / AGENTS` 패널에 `~/.claude/skills`의 skill이 보이는지
      눈으로 확인한다. 이 장비 기준 18개다. 스크린샷을 남긴다
- [ ] **수동**: repo를 골랐다 풀었다 하며 목록이 바뀌는지 확인한다
- [ ] 각 단계에서 회귀 테스트를 하나씩 망가뜨려 빨간불이 되는지 확인했다

## 계획 이탈 기록

- **4단계의 조회 키 변경을 1단계로 앞당겼다.** 계획은 "1단계가 4단계보다 먼저 들어가도
  안전하다 — 그 사이엔 글로벌 스캔이 아직 없고 repo asset은 기존 조회로도 찾힌다"고 봤다.
  **틀렸다.** 기존 테스트 "같은 파일명이 다른 repo에 있으면 서로 다른 행이다"가 같은
  `file_path`를 두 repo로 넣는데, 옛 조회 키 `(workspace, repo_id, file_path)`로는 두 번째를
  못 찾아 INSERT를 시도하고 새 유니크 인덱스에 걸린다. 두 변경이 한 커밋에 함께 있어야 한다.
- **그 테스트를 새 규칙으로 교체했다.** 옛 규칙(같은 경로 + 다른 repo = 별개 행)은 파일
  하나가 두 곳에 동시에 있다는 뜻이라 물리적으로 성립하지 않는다. 대신 "repo가 달라도 같은
  파일이면 한 행"과 "경로가 다르면 별개 행" 둘로 나눴다.
- **upsert가 `repo_id`도 갱신하게 했다.** 조회 키에서 뺐으므로, 같은 파일이 다른 repo로
  다시 발견되면 그 값을 따라가야 한다.
