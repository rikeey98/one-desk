# Spec: repo의 지시 파일(CLAUDE.md·AGENTS.md) 보기

- 출처: `intent.md` (승인됨 2026-09-21)
- 작성자: 권용현
- 상태: 승인됨 (2026-09-21)
- 작성일: 2026-09-21

## 1. 범위

두 조각이고 순서가 있다. (A)가 없으면 (B)는 목록에 이름만 뜨고 아무것도 볼 수 없다.

- **(A) discovered asset의 본문 보기.** 상세를 열면 파일 내용이 읽기 전용으로 보인다.
  skill·agent·지시 파일 모두 같은 통로다. 자리표시자("본문은 실행 시점에 이 파일에서
  읽습니다")가 사라진다.
- **(B) 지시 파일을 asset의 세 번째 종류로.** repo 루트의 `CLAUDE.md`·`AGENTS.md`를
  스캔이 발견해 `instructions` 종류로 올린다. 목록·repo 필터·"없음"·재스캔 전부 기존
  규칙을 그대로 탄다.

**빠지는 것**

- 지시 파일을 맥락에 담는 것(intent 결정). ＋가 없고 core도 거부한다.
- `.claude/CLAUDE.md`·`CLAUDE.local.md`·글로벌 `~/.claude/CLAUDE.md`(intent 결정).
- discovered 편집(설계 §6-2 그대로), 마크다운 렌더링(설계 §6-3 그대로).
- 본문 저장. DB에 두지 않는다(설계 §2-2 그대로) — 읽어서 보여줄 뿐이다.

## 2. 기능 요구사항

### (A) 본문 보기

- **FR-1.** discovered asset의 상세를 열면 **그 파일의 지금 내용**이 읽기 전용 본문으로
  보인다. 저장하지 않으므로 파일을 고친 뒤 다시 열면 고친 내용이 보인다.
- **FR-2.** 파일을 읽지 못하면 **빈 본문이 아니라 실패가 보인다** — "파일을 읽을 수
  없습니다"와 경로. 빈 칸은 "파일이 비었다"로 읽힌다(intent 제약).
- **FR-3.** 본문 읽기는 **asset id로만** 요청한다. 경로는 core가 DB에서 찾는다. 렌더러가
  경로를 넘기는 API는 없다(`core/app/reveal.ts`가 이름만 받는 것과 같은 원칙).
- **FR-4.** authored asset은 지금처럼 DB의 본문을 편집한다. 바뀌지 않는다.
- **FR-5.** 읽기 실패는 던지지 않고 `{ ok: false, reason }`으로 온다 — preload가 IPC
  오류의 클래스를 벗겨내므로 예외로는 가려낼 수 없다(`updateIfUnchanged`와 같은 이유).

### (B) 지시 파일

- **FR-6.** repo 스캔이 루트의 `CLAUDE.md`·`AGENTS.md`를 발견해 `kind: 'instructions'`로
  올린다. 이름은 **파일명 그대로**(`CLAUDE.md`) — 확장자를 떼면 무엇인지 알아보기 어렵고,
  파일명 자체가 CLI가 찾는 정체성이다. frontmatter가 있으면 `description`만 쓴다.
- **FR-7.** 패널에 세 번째 절 **`INSTRUCTIONS`**가 `SKILLS`·`AGENTS` 아래에 붙는다. 없으면
  "없습니다"다. 각 줄은 이름·출처(repo 이름)·"없음" 배지를 기존 줄과 같게 보인다.
- **FR-8.** **지시 파일 줄에는 ＋(맥락에 담기)가 없다.** 보기 전용이다.
- **FR-9.** core의 맥락 조립은 `instructions` 종류를 **거부한다** — IPC로 그 id를 밀어 넣으면
  실행이 "지시 파일은 맥락에 담을 수 없습니다"로 실패한다. 조용히 빼지 않는다(설계
  §5-3 "조용히 빼지 않는다"와 같은 태도). CLI가 알아서 싣는 파일을 두 번 보내는 일이
  구조적으로 불가능해진다.
- **FR-10.** `instructions`는 앱에서 작성할 수 없다. 새 asset 종류 드롭다운에 없고, core의
  `createAuthored`도 거부한다.
- **FR-11.** 글로벌 루트 스캔은 바뀌지 않는다 — 지시 파일은 repo 루트에서만 찾는다.
- **FR-12.** repo 필터 규칙(asset-scope FR-5)이 그대로 적용된다. repo를 고르면 그 repo의
  지시 파일만, 고르지 않으면 모든 repo의 것이 출처와 함께 보인다.
- **FR-13.** 마이그레이션이 없다. `kind` 컬럼에 CHECK 제약이 없어 값 하나가 늘어도 스키마가
  바뀌지 않는다.

## 3. 인터페이스

### 3-1. `assets.readBody(id)`

```ts
type AssetBody =
  | { ok: true; content: string }
  | { ok: false; reason: string }

client.assets.readBody(id: string): Promise<AssetBody>
```

- authored → `{ ok: true, content: row.content ?? '' }`. 통로를 하나로 두어 렌더러가 source로
  가르지 않게 한다.
- discovered → `readFile(row.filePath, 'utf8')`. 실패하면 `{ ok: false, reason: '파일을 읽을
  수 없습니다: <경로>' }`.
- 없는 id는 던진다(`NotFoundError`) — 잘못된 호출이지 파일 문제가 아니다.

읽기 함수는 `core/assets/body.ts`의 `readAssetBody(row)` 하나이고, **실행 서비스의
`resolveAssets`도 이것을 쓴다.** 두 자리가 따로 `readFile`을 부르면 인코딩·오류 처리가
갈린다.

### 3-2. 스캔

`scanRepo(repoPath)`가 기존 세 디렉토리에 더해 루트의 두 파일을 본다.

```
<repo>/CLAUDE.md  → { kind: 'instructions', name: 'CLAUDE.md', description, filePath }
<repo>/AGENTS.md  → { kind: 'instructions', name: 'AGENTS.md', description, filePath }
```

없거나 못 읽으면 건너뛴다. 스캔은 여전히 던지지 않는다.

### 3-3. 패널 마크업

기존 `group(kind, title)`이 세 번째 절을 그린다. `instructions`일 때 담기 버튼
(`aria-label="… 맥락에 담기"`)을 **렌더하지 않는다** — 숨기는 것이 아니라 없다.

## 4. 데이터 모델

바뀌지 않는다. `AssetKind`가 `'skill' | 'agent' | 'instructions'`가 될 뿐이다. 행의
모양(`source: 'discovered'`, `repoId`, `filePath`, `content: null`, `lastSeenAt`)은 skill과 같다.

## 5. 비기능 요구사항

- **NFR-1.** 경계 셋(core↔electron, renderer↔core, 얇은 IPC).
- **NFR-2.** 본문 읽기 통로는 **id → DB의 `filePath`** 한 방향뿐이다. `readBody`에 경로를
  받는 오버로드를 만들지 않는다. 검증은 core 함수에 두어 테스트로 고정한다.
- **NFR-3.** 본문은 평문 `<textarea readOnly>`로 그린다. 외부 repo의 파일이라 신뢰할 수 없다.
- **NFR-4.** 상세를 열 때만 읽는다. 목록을 그릴 때 파일을 읽지 않는다 — repo가 많으면
  목록 한 번에 파일 수십 개를 읽게 된다.

## 6. 확인 필요 항목

- **[판단 필요] 절 이름 `INSTRUCTIONS`.** `SKILLS`·`AGENTS`가 영문 대문자라 맞췄다. 한국어
  "지시"로 하면 다른 두 절과 어긋난다. 제안대로 간다.
- **[확인 필요] 대소문자.** Windows·macOS 파일시스템은 대소문자를 구분하지 않아 `claude.md`도
  CLI가 읽는다. 스캔은 정확한 이름(`CLAUDE.md`)만 시도하고, 그런 파일시스템에서는 OS가
  알아서 맞춰준다. Linux에서 소문자 파일은 CLI도 못 읽으므로 안 보이는 것이 맞다.
- **[확인됨] 기존 테스트가 "없습니다"를 단일 텍스트로 잡지 않는다.** grep 결과 e2e의
  선택자는 전부 더 긴 문구("처리할 결과가 없습니다"·"workspace가 없습니다")라, 절이 셋이
  되어 빈 절의 "없습니다"가 셋 떠도 걸리지 않는다.

## 7. 성공 기준 (검증 가능한 형태)

- `CLAUDE.md`(frontmatter 없음)와 `AGENTS.md`를 둔 임시 repo를 `scanRepo`하면 `instructions`
  둘이 나오고 이름이 파일명 그대로다. (단위)
- 세 종류가 섞인 목록을 그리면 `INSTRUCTIONS` 절에 지시 파일만 있고, 그 줄에는 "맥락에
  담기" 버튼이 없으며 skill 줄에는 있다. (단위)
- discovered asset의 상세를 열면 `readBody`를 그 id로 부르고 돌아온 본문이 textarea에
  보인다. `{ ok: false }`면 reason이 보이고 textarea는 비어 있지 않다(실패 문구가 본문 대신
  들어간다). (단위)
- `instructions` id를 맥락에 넣어 `execution.start`하면 실행이 실패로 끝나고 오류 메시지에
  "지시 파일"이 들어 있다. (단위)
- `createAuthored({ kind: 'instructions' })`가 던진다. (단위)
- e2e: repo 등록 전에 `CLAUDE.md`를 심으면 등록 뒤 `INSTRUCTIONS`에 `CLAUDE.md`가 보이고,
  "CLAUDE.md 맥락에 담기" 버튼은 없으며, 이름을 누르면 본문에 심은 내용이 보인다. 기존
  `asset.e2e.ts` 흐름은 그대로 통과한다.
- 마이그레이션 파일이 생기지 않는다(`git status`에 `drizzle/` 변화 없음).
