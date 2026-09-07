# asset 스캔 설계

작성일 2026-09-07. 5단계("나머지" — OpenCode 어댑터 · asset 스캔 · diff 뷰어)의 **두 번째**
하위 과제. 첫째(OpenCode 어댑터)는 `2026-09-06-opencode-adapter-design.md`로 끝났다.

전체 설계 `2026-08-07-one-desk-design.md` §5(데이터 모델)·§6(맥락 조립)을 따른다.
그 문서가 이미 정해둔 것 — 테이블 모양, 스캔 경로, frontmatter 규칙, 사라진 파일을
지우지 않는 것 — 은 그대로 쓰고, 정하지 않은 것만 여기서 정한다.

## 1. 범위

**포함한다.**

- repo에서 skill/agent 파일을 **발견**한다 (`discovered`)
- 앱 안에서 skill/agent를 **직접 쓰고 고친다** (`authored`)
- `AssetPanel`의 "5단계에서 추가됩니다"를 실제 목록으로 바꾼다
- 맥락에 담아 실행하면 프롬프트에 실린다

**빠진다.**

- **MCP 노출.** agent가 asset을 읽거나 만드는 도구는 더하지 않는다. 4단계가 그은
  경계(도구 아홉 개)를 이 과제가 넓히지 않는다.
- **마크다운 렌더링.** 본문은 평문으로 보여준다(§6-3).
- **`--agent` / `--agents` 네이티브 경로.** agent asset은 "그 역할로 실행"이 아니라
  "배경으로 읽힌다"이다(§5-1). 어댑터를 건드리지 않는다.
- **파일 감시(watcher).** 스캔 시점은 셋으로 고정한다(§3-2).

## 2. 데이터 모델

전체 설계 §156의 스케치를 그대로 쓴다. **마이그레이션 `0004`가 붙는다** —
`asset` 테이블은 아직 없다.

| 컬럼 | 비고 |
|---|---|
| `id` | `randomUUID()` |
| `workspace_id` | cascade |
| `kind` | `'skill' \| 'agent'` |
| `source` | `'discovered' \| 'authored'` |
| `name` `description` | frontmatter에서 읽거나(discovered) 사용자가 쓴다(authored) |
| `repo_id` | discovered일 때 발견된 repo. authored는 null |
| `file_path` | discovered일 때 절대 경로. authored는 null |
| `content` | **authored일 때만.** discovered는 null |
| `last_seen_at` | discovered일 때 마지막으로 파일을 본 시각 |
| `created_at` `updated_at` | epoch ms |

### 2-1. 스케치에 없는 `updated_at`을 더한다

전체 설계 §156의 `asset` 스케치에는 `updated_at`이 없다. **`authored` 본문 편집에는
이슈·메모와 같은 낙관적 잠금(`updateIfUnchanged`)이 필요하고, 그것은 `updatedAt`
없이 성립하지 않는다.** 스케치가 `authored`를 "본문을 DB에 담는다"고만 적고 편집을
생각하지 않은 자리다. 더한다.

`updatedAt`은 이슈·메모와 같은 규칙을 따른다 — `Math.max(Date.now(), previous + 1)`로
**반드시 이전 값보다 크게** 만든다. 같은 밀리초 안에 두 번 쓰면 `Date.now()`만으로는
값이 같아져 "그 사이 바뀌었다"를 놓친다.

### 2-2. `discovered`의 본문은 저장하지 않는다

전체 설계 §222 그대로다. 경로와 메타데이터만 기록하고 본문은 **실행 시점에 디스크에서
읽는다.** 파일이 수정돼도 항상 최신이 반영된다.

## 3. 스캔

### 3-1. 대상 경로

전체 설계 §224의 표 그대로. 각 repo 루트 기준이다.

| kind | 경로 |
|---|---|
| skill | `.claude/skills/*/SKILL.md` |
| agent | `.claude/agents/*.md` |
| agent | `.opencode/agent/*.md` |

### 3-2. 언제 도는가

셋뿐이다. 예측 가능한 시점에만 돈다.

1. **repo를 등록할 때** — 그 repo만
2. **사용자가 새로고침을 누를 때** — 지금 workspace의 모든 repo
3. **앱을 열 때** — 모든 workspace의 모든 repo, 한 번

셋째는 전체 설계 §224에 없다. 여기서 더한다: 없으면 "어제 만든 skill이 안 보인다"가
가장 흔한 불편이 되고, glob 세 개짜리 스캔이라 부팅을 눈에 띄게 늦추지 않는다.

파일 감시는 하지 않는다. watcher의 수명 관리·플랫폼차·대용량 repo에서의 부하가
이 기능이 요구하는 것에 비해 무겁다.

### 3-3. 동일성

**동일성 키는 `(workspace_id, repo_id, file_path)`이고 UNIQUE를 건다.**
없으면 스캔할 때마다 같은 파일이 새 행으로 쌓인다. 발견하면 그 키로 upsert하고
`name`·`description`·`last_seen_at`을 갱신한다.

`kind`는 키에 넣지 않는다 — 경로가 kind를 결정하므로 같은 경로에서 kind가 달라질 수 없다.

### 3-4. 사라진 파일

**지우지 않는다.** 전체 설계 §232가 이유를 적어뒀다 — 삭제하면 그 asset을 첨부했던
과거 run의 기록이 끊긴다.

대신 `last_seen_at`으로 판정한다. 스캔이 끝난 뒤 그 repo의 asset 중 이번 스캔에서
보이지 않은 것은 `last_seen_at`이 갱신되지 않으므로, 목록에서 **"없음" 배지**가 붙는다.

**repo 경로 자체가 사라졌으면** 그 repo의 discovered asset이 전부 "없음"이 된다.
스캔이 디렉토리를 못 읽는 것과 파일이 없는 것을 구분하지 않는다 — 사용자에게 보이는
결과가 같고("이 파일 지금 없다"), 구분해 봐야 할 일이 달라지지 않는다.

**스캔은 `authored` 행을 건드리지 않는다.** `source`로 갈라 본다. 안 그러면 앱에서
쓴 asset이 첫 스캔에 전부 "없음"이 된다.

## 4. frontmatter 파서

전체 설계 §232는 "YAML frontmatter에서 `name`과 `description`을 읽는다"까지만 정했다.
어디까지 파싱할지가 열려 있다.

**새 의존성을 들이지 않는다.** 지금 런타임 의존성은 넷뿐이고(`@modelcontextprotocol/sdk`,
`better-sqlite3`, `drizzle-orm`, `zod`), frontmatter 두 필드를 읽자고 YAML 파서를
더하는 것은 균형이 맞지 않는다.

대신 **실측한 모양만** 다룬다. 이 장비의 SKILL.md들을 훑어 확인한 넷이다.

```yaml
name: brainstorming
description: Use when facing 2+ independent tasks
description: "따옴표로 감싼 한 줄"
description:
  "다음 줄부터 들여쓰기로 이어지는 여러 줄. 실제로 존재한다 —
  math-olympiad/SKILL.md가 이 모양이다."
```

규칙은 이렇다.

- 파일이 `---` 줄로 시작할 때만 frontmatter로 본다. 아니면 없는 것으로 친다.
- 다음 `---`까지가 블록이다.
- `key: 값` 형태에서 `name`과 `description`만 집는다. 나머지 키는 무시한다.
- **값이 비어 있으면 다음 줄부터 들여쓴 줄들을 공백으로 이어붙인다.** 이 처리가 없으면
  실제 파일의 설명이 빈칸이 된다.
- 감싼 따옴표(`"` 또는 `'`)는 벗긴다.
- `>` `|` 같은 블록 지시자가 붙어 있으면 지시자만 떼고 같은 방식으로 이어붙인다.

**frontmatter가 없거나 `name`이 없으면 파일명을 이름으로 쓴다** — skill은 그 파일이
든 디렉토리 이름(`.claude/skills/<이름>/SKILL.md`), agent는 확장자를 뗀 파일명이다.
설명은 빈칸으로 둔다. 전체 설계 §232가 정한 그대로다.

파서는 순수 함수로 떼어내 실제 파일 내용을 픽스처로 두고 검증한다.

## 5. 맥락 조립

### 5-1. agent asset은 "배경으로 읽힌다"

전체 설계 §290이 전제한 방식이다 — `<context>` 안에 `<skills>`·`<agents>` 블록으로
**본문을 실어 보낸다.**

§220이 언급한 "OpenCode의 `--agent` 플래그" 경로는 **택하지 않는다.** 그것은 다른
기능이다: `--agent`는 한 번에 하나만 고를 수 있어 "여러 개를 담는다"가 성립하지 않고,
두 어댑터를 모두 고쳐야 하며, `discovered`와 `authored`를 다르게 취급해야 한다.
배경으로 읽히는 쪽은 두 CLI에서 똑같이 동작하고 어댑터를 건드리지 않는다.

이 선택의 대가를 적어둔다: **agent는 그 역할로 "실행"되지 않는다.** 모델은 그 정의를
읽을 뿐이다. `authored` skill도 CLI가 아는 진짜 skill이 되지 않아 `/skill-name`으로
호출되지 않는다. 네이티브 경로가 필요해지면 별도 설계에서 다룬다.

### 5-2. `assemblePrompt`는 순수하게 유지한다

전체 설계 §297은 "`discovered` asset의 본문은 이 시점에 디스크에서 읽는다"고 적었다.
그대로 하되 **읽는 주체는 조립기가 아니다.**

`assemblePrompt`는 지금 `{repos, issues, memos, userPrompt}`를 받는 순수 함수다.
디스크를 읽게 만들면 테스트가 파일시스템을 깔아야 하고, `core/`가 경로를 인자로 받는
규칙과도 어긋난다. **호출자(실행 서비스)가 파일을 읽어 `{name, description, content}`
로 넘긴다.** 조립기는 지금 모양을 지킨다.

### 5-3. 사라진 파일을 담아 실행하면

**조용히 빼지 않는다.** 담았는데 프롬프트에 없으면 사용자는 agent가 그 skill을 읽고도
무시했다고 오해한다.

run 로그에 `error` 이벤트를 남겨 화면에 보이게 한다. **run은 실패시키지 않는다** —
나머지 맥락으로 할 수 있는 일이 있고, agent가 이미 시작한 것을 무효로 돌릴 이유가 없다.
`claudeCode.ts`가 MCP 서버 연결 실패를 다루는 방식과 같은 선례다(§`parseLine`의
`system/init` 분기).

## 6. UI

### 6-1. 목록

`AssetPanel`의 "5단계에서 추가됩니다"를 실제 목록으로 바꾼다. 패널 제목은
`Skills / Agents` 그대로다.

- **kind로 나눈다** — SKILLS와 AGENTS 두 묶음. 이슈 훑기의 축 그룹핑 같은 장치는
  두지 않는다. asset은 분류할 것이 아니라 고를 것이다.
- 각 줄은 이름과 설명 한 줄, 그리고 출처(어느 repo에서 발견됐는지 / 앱에서 쓴 것인지)
- **"없음" 배지** — 파일이 사라진 discovered asset
- **새로고침 버튼** — 지금 workspace의 모든 repo를 다시 스캔한다
- 맥락 담기 ＋ 토글은 이슈·메모와 **같은 모양**이다

### 6-2. 작성과 편집

`authored` asset은 이름·설명·본문을 앱에서 쓴다. `IssueDetail`/`MemoDetail`이 이미
푼 문제를 그대로 따른다 — 디바운스 자동 저장, `updateIfUnchanged`로 낙관적 잠금,
충돌 배너, 그리고 **성공한 저장마다 기대값을 갱신하는 것**(안 하면 다음 자동 저장이
낡은 `expectedUpdatedAt`을 들고 가 자기 자신과 충돌한다).

`discovered` asset은 앱에서 편집하지 않는다. 본문은 파일이 원본이고, 앱이 고치면
어느 쪽이 진짜인지 알 수 없게 된다. 읽기 전용으로 보여주고 경로를 함께 띄운다.

### 6-3. 본문은 평문으로 그린다

**외부 repo의 SKILL.md를 화면에 그리는 기능이다.** 실측 노트가 정확히 이 자리를
지목한다 — 렌더링에 구멍이 있으면 그 스크립트가 `window.oneDesk`를 통해
`runs.start({ permission: 'full', ... })`를 부를 수 있다.

마크다운 렌더링은 이 과제의 범위가 아니고, 나중에 붙일 때도 **asset 본문은 신뢰할 수
없는 입력**이라는 것을 그 설계가 다뤄야 한다.

## 7. 대칭 규칙

`issue.ts`↔`memo.ts`의 "의도된 중복"과 대칭 유지 규칙은 **asset에 적용하지 않는다.**

asset은 셋째 종류이고 모양이 다르다 — repo 연결이 N:M 태그가 아니라 단일 FK(`repo_id`)이고,
`kind`·`source`·`file_path`·`last_seen_at`이 있으며, 본문이 있는 행과 없는 행이 섞인다.
이슈·메모와 대칭을 맞추려 들면 없는 개념을 억지로 만들게 된다.

공통으로 **가져오는** 것은 하나뿐이다: `authored` 본문 편집의 낙관적 잠금 규칙(§2-1·§6-2).
그것은 대칭이 아니라 같은 함정을 두 번 밟지 않는 것이다.

## 8. 테스트

- **파서:** 실측한 네 모양을 픽스처로 두고 순수 함수를 검증한다. 특히 **여러 줄
  `description`** — 그것이 빠지면 실제 파일의 설명이 조용히 빈칸이 된다.
- **스캔:** 임시 디렉토리에 세 경로 구조를 만들어 실제로 훑는다. 같은 스캔을 두 번
  돌려 **행이 늘지 않는지**(동일성 키가 실제로 작동하는지) 본다. 파일을 지우고 다시
  훑어 행이 남고 `last_seen_at`이 그대로인지 본다. `authored` 행이 살아남는지 본다.
- **조립:** `<skills>`·`<agents>` 블록이 나오고, 본문이 이스케이프되며, 사라진 파일이
  `error` 이벤트를 낳는지.
- **저장소:** `updateIfUnchanged`가 충돌을 잡고, `updatedAt`이 같은 밀리초에도 단조
  증가하는지.
- **배선:** `App.tsx`가 `AssetPanel`에 내려보내는 prop과 IPC 채널. 3a·3b 리뷰가 샌
  자리는 예외 없이 이런 한 줄이었다.

## 9. 전체 설계 문서에 대한 보완

`2026-08-07-one-desk-design.md`에 다음을 덧붙여야 한다.

- §156의 `asset` 스케치에 **`updated_at`이 빠져 있다** — `authored` 편집의 낙관적
  잠금에 필요하다(§2-1)
- §224의 스캔 시점에 **"앱을 열 때"를 더한다**(§3-2)
- §232가 정하지 않은 **동일성 키**는 `(workspace_id, repo_id, file_path)`다(§3-3)
- §290·§297의 조립에서 **디스크를 읽는 주체는 조립기가 아니라 호출자**다(§5-2)
