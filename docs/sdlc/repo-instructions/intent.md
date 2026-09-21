# Intent: repo의 지시 파일(CLAUDE.md·AGENTS.md) 보기

- 작성자: 권용현
- 상태: 승인됨 (2026-09-21)
- 작성일: 2026-09-21

## 문제

**SKILLS / AGENTS 패널에서 지금 고른 repo의 `CLAUDE.md`·`AGENTS.md`를 볼 수 없다.**
2026-09-21 사용자 요청: "skills / agents 쪽에 현재 선택된 repo의 AGENTS.md 또는
CLAUDE.md를 볼 수 있게 해줘".

agent가 repo에서 가장 먼저, 가장 확실히 읽는 파일이 이 둘이다 — claude는 `CLAUDE.md`를,
opencode는 `AGENTS.md`를 실행할 때마다 자동으로 싣는다. skill과 agent 정의는 패널에
나열되는데 정작 그 위에 깔리는 지시 파일은 앱 어디에도 보이지 않아, "이 repo에서 agent가
무엇을 전제로 도는가"를 확인하려면 에디터를 따로 열어야 한다.

파고들자 **같은 패널의 더 근본적인 구멍**이 드러났다. discovered asset(파일에서 발견한
skill·agent)은 이름을 눌러 상세를 열어도 **본문이 보이지 않는다.** `AssetDetail`이
"본문은 실행 시점에 이 파일에서 읽습니다"라는 자리표시자만 띄운다(asset 스캔 설계
§2-2·§6-2). 그러니 지시 파일을 목록에 올리기만 해서는 아무것도 볼 수 없다 — 본문을
읽어 보여주는 통로가 먼저 있어야 하고, 그 통로는 SKILL.md에도 똑같이 필요한 것이었다.

## 현황 (읽고 확인한 것)

- **스캔 대상은 세 디렉토리뿐이다** — `.claude/skills`·`.claude/agents`·`.opencode/agent`
  (`core/assets/scan.ts`). repo 루트의 파일은 보지 않는다.
- **`asset.kind`는 타입에만 열거돼 있다.** DB 컬럼은 `kind text NOT NULL`이고 CHECK 제약이
  없다(`drizzle/0004`). 종류를 하나 더해도 **마이그레이션이 필요 없다.**
- **discovered의 본문은 DB에 없고 실행 시점에 디스크에서 읽는다**(설계 §2-2, 전체 설계
  §222). 저장하지 않는 결정은 그대로 두되, **보여주기 위해 읽는 것**은 그 결정과 어긋나지
  않는다 — 실행 서비스의 `resolveAssets`가 이미 `readFile(row.filePath)`로 같은 일을 한다.
- 목록은 repo를 고르면 "글로벌 + 그 repo + 앱에서 작성한 것"만 보인다(asset-scope spec).
  "현재 선택된 repo의"는 이 필터가 이미 준다.
- `AssetPanel`은 `kind`로 절을 나눈다(`SKILLS`·`AGENTS`). 절 하나를 더하는 자리가 있다.
- 클릭 가능한 항목마다 ＋(맥락에 담기)가 붙는다. 지시 파일에도 붙일지가 아래 결정 사항이다.

## 원하는 결과

- repo를 고르면 SKILLS / AGENTS 패널에 **그 repo의 `CLAUDE.md`·`AGENTS.md`가 보인다.**
  이름을 누르면 **본문이 읽기 전용으로** 보인다. 파일이 없는 repo에서는 그 절이 비어 있다.
- 같은 통로로 **discovered skill·agent의 본문도 보인다.** 자리표시자가 사라진다.
- 본문은 **평문**으로 그린다 — 외부 repo의 파일이라 신뢰할 수 없는 입력이다(설계 §6-3).
- 실행 동작은 바뀌지 않는다. 지시 파일은 CLI가 알아서 싣는 것이고 앱이 끼어들 일이 없다.

## 영향 범위

- **사용자**: repo를 여러 개 다루는 사용자. 특히 agent가 repo마다 다른 규칙 아래 도는 것을
  확인하고 싶은 사람(현재 한 명, 작성자).
- **시스템**:
  - `core/assets/scan.ts` — repo 루트의 두 파일을 훑는다. 글로벌 루트는 그대로.
  - `shared/models.ts` `AssetKind` — 종류 하나 추가. **마이그레이션 없음.**
  - `core` 서비스 + IPC + preload + `shared/client.ts` — `assets.readBody(id)` 한 통로.
    **경로가 아니라 id를 받는다** — 앱이 임의 파일을 읽는 통로가 되면 안 된다
    (`core/app/reveal.ts`가 이름만 받는 것과 같은 원칙).
  - `renderer/components/AssetPanel.tsx`·`AssetDetail.tsx` — 절 추가, 본문 표시.
  - `core/context/assemble.ts`·`core/execution.ts` — 지시 파일이 맥락에 실리지 않게 하는
    방어선(담을 수 없게 하기로 결정할 경우).
- **건드리지 않는 것**: 어댑터·권한·큐·MCP 도구. 스캔 시각 규칙(한 스캔 = 시각 하나)도
  그대로.

## 제약

- `core/`는 `electron`을 모르고, `renderer/`는 `core/`를 모르며, IPC 핸들러는 얇다.
- **본문 읽기는 id로만 한다.** 렌더러가 경로를 넘기는 API를 만들지 않는다.
- **읽기 실패는 조용히 빈 본문이 되면 안 된다.** 파일이 사라졌으면 그렇다고 보인다 —
  빈 칸은 "파일이 비었다"로 읽힌다(설계 §6-2의 자리표시자가 있던 이유).
- 스캔은 여전히 어떤 경우에도 던지지 않는다.
- discovered는 편집하지 않는다(설계 §6-2). 지시 파일도 같다.
- 스타일은 `index.css`의 한 줄 한 규칙 형식.

## 성공 기준

- `CLAUDE.md`와 `AGENTS.md`를 둔 repo를 고르면 패널에 둘 다 보이고, 누르면 파일 내용이
  그대로 보인다. 없는 repo를 고르면 그 절이 "없습니다"다.
- 파일을 고친 뒤 다시 열면 고친 내용이 보인다(저장하지 않으므로 항상 최신).
- discovered skill의 상세에서도 본문이 보인다. 파일을 지운 뒤 열면 "읽을 수 없다"가 보이고
  빈 칸이 아니다.
- 기존 e2e(`asset.e2e.ts`) 전부 통과. 마이그레이션이 생기지 않는다.

## 결정 (2026-09-21, 사용자)

- **보기 전용이다 — ＋가 없다.** claude는 `CLAUDE.md`를, opencode는 `AGENTS.md`를 실행할
  때 알아서 싣는다. 담으면 같은 본문이 프롬프트에 두 번 들어간다. 패널에 담기 버튼이
  없을 뿐 아니라 **core의 맥락 조립도 이 종류를 거부한다** — IPC로 밀어 넣어도 실리지
  않는다. 다른 CLI에 보내는 용도(claude에 `AGENTS.md`)는 필요해지면 별도 intent.
- **repo 루트의 `CLAUDE.md`·`AGENTS.md` 둘만.** `.claude/CLAUDE.md`·`CLAUDE.local.md`·
  글로벌 `~/.claude/CLAUDE.md`는 이번 범위 밖이다.

## 미해결 질문

- [ ] 패널의 절 이름 — Design에서 정한다.
