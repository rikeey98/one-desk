# Spec: 기간 리포트

- 출처: `intent.md` (결정 반영 2026-10-07)
- 작성자: 권용현 (초안: Claude)
- 상태: 승인 (2026-10-07, 사용자 위임 — "끝까지 권장사항으로"). §6의 우려 1~3은 권장안(안내문으로 알리고 받아들인다)으로 정했다
- 작성일: 2026-10-07
- 시안: https://claude.ai/artifact/6bn58ES8XQwBP9k68VfV4E (세 보기의 구조. 예시 데이터)

## 0. intent의 미해결 질문에 대한 답

| 질문 | 이 spec의 답 | 자리 |
|---|---|---|
| 메모를 어느 workspace에 저장하나 | **지금 고른 workspace**, 없으면 리포트에 담긴 첫 workspace. 버튼 글자가 대상을 말한다(`one-desk에 메모로 저장`) | FR-23 |
| 주의 시작 | **월요일**. 프리셋은 이번 주 · 지난주 · 지난 7일 · 지난 30일 + 직접 지정 | FR-3 |
| 대화의 걸린 시간을 싣나 | **싣는다. 이름은 "agent 실행"** — 사람이 일한 시간이 아니다 | FR-9 |
| 하루 단위 흐름 | **요일 탭이 맡는다**. 문서 탭에는 하루 막대 한 줄만 둔다 | FR-16·17 |

## 1. 범위

다섯 조각이다. (A) core가 여러 workspace에서 기간 데이터를 고른다, (B) 렌더러의 순수 함수가 그것을 세
보기와 마크다운으로 편다, (C) 화면, (D) 내보내기(복사·메모·agent에게 다듬기), (E) 진입점.

**빠지는 것**
- MCP 변경 — 도구는 여전히 토큰의 workspace 하나만 본다(전체 설계 §8). 리포트는 MCP를 거치지 않는다.
- 활동 기록(상태 변화 이력) — timestamps spec §4 그대로. 이슈마다 마지막 `startedAt`·`closedAt`뿐이다.
- 리포트 저장·예약 생성·자동 발송. 리포트는 열 때마다 새로 만든다.
- 파일로 내보내기(.md·.pdf). 복사와 메모로 충분하다.
- 패널 창(`item-windows`)으로 리포트 열기.

## 2. 기능 요구사항

### (A) core — 기간 데이터 고르기

- **FR-1** `core.reports.build({ workspaceIds, since, until })`가 `ReportData`를 돌려준다. `since`·`until`은
  epoch ms이고 `[since, until)`이다. 빈 `workspaceIds`는 빈 리포트다(전체를 뜻하지 않는다 — 렌더러가 고른
  것을 그대로 넘긴다). 없는 workspace id는 건너뛴다.
- **FR-2** "기간 안"의 정의는 MCP와 **같은 함수**다. `core/mcp/tools.ts`의 `touchedIn`과
  `core/mcp/conversations.ts`의 `summarizeConversations`·그 아래 순수 함수를 `core/period/`로 옮기고 MCP와
  리포트가 같이 import한다. 따로 두면 agent가 `list_issues`로 센 수와 화면의 수가 갈린다.
  - 이슈: `createdAt`·`startedAt`·`closedAt`·`updatedAt` 중 하나가 기간 안.
  - 메모: `createdAt`·`updatedAt` 중 하나가 기간 안.
  - 대화: `[첫 턴 생성, 마지막 활동]`이 기간과 겹친다(`summarizeConversations`와 같다).
- **FR-3** 기간은 렌더러가 **앱의 시간대**로 계산한다. 이번 주 = 이번 주 월요일 0시 ~ 다음 월요일 0시(축이 한 주 전체를 그린다 — 끝나지 않은 막대는 지금에서 멈춘다), 지난주 = 지난
  월요일 0시 ~ 이번 월요일 0시, 지난 7일 = 6일 전 0시 ~ 내일 0시, 지난 30일 = 29일 전 0시 ~ 내일 0시. 직접
  지정은 시작일 0시 ~ 끝날 **다음 날** 0시(끝날을 포함). 계산은 `renderer/report/period.ts`의 순수 함수이고
  `now`를 인자로 받는다.
- **FR-4** `ReportData`의 모양:
  ```ts
  interface ReportData {
    since: number; until: number
    workspaces: Array<{
      id: string; name: string
      issues: ReportIssue[]        // 기간 안에 손댄 이슈. 본문 없음
      memos: ReportMemo[]          // id·title·createdAt·updatedAt
      conversations: ReportConversation[]
    }>
  }
  interface ReportIssue { id; title; status; priority; createdAt; startedAt; closedAt; updatedAt }
  interface ReportConversation {
    id; title; status; needsAnswer; closed; issueId     // summarizeConversations와 같은 뜻
    turns: Array<{ createdAt; startedAt: number | null; endedAt: number | null }>  // 오래된 순, 기간 밖 턴 포함
    lastAnswer: string | null                           // 앞 300자 (MCP와 같은 길이)
  }
  ```
  시각은 epoch ms다(IPC 안쪽이라 ISO일 이유가 없다 — ISO는 모델에게 내보낼 때뿐이다). 지시 원문·맥락·로그는
  싣지 않는다.
- **FR-5** 읽기만 한다. 저장소에 새 메서드가 필요하면 `list` 계열만 더한다. 스키마·마이그레이션 없음.

### (B) 렌더러 — 투영 (순수 함수)

`renderer/report/`에 둔다. 컴포넌트는 그리기만 한다(대화록의 `projectTurn`과 같은 이유 — 렌더링 없이
경계값을 고정한다).

- **FR-6** `classify(issue, range)`가 이슈 하나를 **한 칸에만** 넣는다. 위에서부터 처음 맞는 칸이다:
  1. 완료 — `closedAt`이 기간 안이고 지금 status가 `done`
  2. 시작 — `startedAt`이 기간 안
  3. 새로 만듦 — `createdAt`이 기간 안
  4. 손댐 — 그 밖(`updatedAt`만 기간 안)

  "진행 중"은 칸이 아니라 표시다: 지금 status가 `doing`인 이슈에 진행 알약이 붙는다. **기간 끝 시점의
  상태는 알 수 없다** — 지금 상태를 보인다는 것을 화면 안내문이 말한다(FR-12).
- **FR-7** 합계: 새 이슈(`createdAt`이 기간 안인 수), 완료(1번 칸의 수), 진행 중(지금 doing이고 기간 안에
  손댄 수), 대화(기간과 겹친 대화 수), agent 실행(FR-9). 칸과 합계가 다른 질문에 답하므로 "새 이슈 9"와
  "새로 만듦 칸 5"가 함께 나올 수 있다 — 완료된 새 이슈는 완료 칸에 있기 때문이다.
- **FR-8** 대화는 `issueId`로 그 이슈 밑에 붙는다. 이슈가 없거나, 할당된 이슈가 리포트에 없으면(기간 안에
  손대지 않음, 지워짐) 그 workspace의 **"이슈 없는 대화"** 묶음으로 간다. 할당된 이슈가 기간 밖이면 묶음
  줄에 그 이슈 제목을 곁글로 단다(id로 찾고, 없으면 달지 않는다 — FR-4에 이슈 목록 밖의 제목은 없으므로
  core가 `conversations[].issueTitle`을 함께 싣는다).
- **FR-9** agent 실행 시간 = 기간 안에서 **시작한** 턴들의 `endedAt − startedAt` 합. 아직 끝나지 않은 턴과
  시작하지 못한 턴은 0이다. 대화 한 줄의 시간도 같은 규칙이다. 표기는 `38분`·`3시간 42분`·`40초`(1분 미만).
- **FR-10** `byDay(data, range)`가 로컬 날짜별로 사건을 편다. 사건은 이슈의 만듦·시작·완료(그 시각이 기간
  안일 때)와 대화의 **그날 시작한 턴이 있는 것**(그날 턴 수와 시간)이다. 한 대화가 여러 날에 나온다.
- **FR-11** `issueTrack(issue, conversations, range)`가 이슈 흐름 한 줄을 0~1 비율로 낸다 — 만듦·시작·완료
  표식(기간 안일 때만), 시작~완료(또는 시작~기간 끝) 막대, 기간 전에 시작했으면 막대가 왼쪽 끝에서 시작하고
  `clippedStart`가 참, 대화 점(턴 시작마다). 기간이 30일이면 눈금은 날마다가 아니라 주마다다.
- **FR-12** `toMarkdown(data, options)`가 내보낼 글을 만든다. 탭과 무관하게 **문서 탭의 순서와 같다**:
  제목(`# 리포트 2026-09-28 ~ 10-04`) → 합계 한 줄 → workspace마다 `## 이름` → `### 완료`·`### 시작`·
  `### 새로 만듦`·`### 손댐`·`### 이슈 없는 대화`·`### 메모`(빈 칸은 빠진다) → 줄마다 `- 제목 — 10-02(금)`,
  그 이슈의 대화는 들여쓴 `- 대화: 제목 · 4턴 · 38분`. 옵션의 "마지막 답 한 줄"이 켜졌으면 대화 줄 아래에
  `> 답의 첫 줄`. 마지막에 안내 한 줄: `상태는 리포트를 만든 때의 것입니다.`
  - 제목·답의 줄바꿈은 공백으로 접는다. 마크다운 문법 문자는 **이스케이프하지 않는다** — 읽는 쪽(`Markdown`)이
    이미 안전하게 그리고, 이스케이프하면 복사해 붙인 곳에서 `\*`가 보인다.

### (C) 화면

- **FR-13** 진입점: 사이드바의 인박스 바로 아래 줄 **`리포트`**(아이콘 막대그래프, 배지 없음). 누르면
  `view = 'report'`. 인박스·설정과 같은 줄 모양이고 선택되면 `--accent-bg`.
- **FR-14** 리포트 화면은 패널 하나(본문 전체, 도크는 그대로 아래)다. 헤더: 제목 `리포트` · 보기 탭 셋
  (`문서`·`요일`·`이슈 흐름`, 설정 탭과 같은 분절 컨트롤) · 오른쪽에 `마크다운 복사`(보조) ·
  `<workspace>에 메모로 저장`(주 동작) · `agent에게 다듬기`(보조).
- **FR-15** 조건(기간·workspace·담을 것)은 **세 탭이 함께 쓴다.** 문서 탭에서는 왼쪽 248px 열에 세로로,
  요일·이슈 흐름 탭에서는 헤더 아래 한 줄 띠로 같은 값을 보인다(시안 그대로). 탭을 바꿔도 조건이 남는다.
  - 기간: 프리셋 넷(분절) + 날짜 두 칸(`<input type="date">`). 날짜를 고치면 프리셋 선택이 풀린다.
  - workspace: 체크 목록(띠에서는 알약). 기본은 **전부**, 옆에 그 기간의 항목 수.
  - 담을 것(문서 탭 열에만): 이슈 · 대화 · 메모 · 대화의 마지막 답 한 줄. 기본 메모 끔, 나머지 켬. 요일·
    이슈 흐름 탭은 이 값을 따르지 않는다(그 보기가 이슈·대화 자체다).
  - 마지막 보기 탭과 담을 것은 localStorage(`renderer/listWidth.ts`와 같은 방식, try/catch)에 남는다.
    기간과 workspace는 남기지 않는다 — 다음에 열면 "지난주·전부"로 시작한다.
- **FR-16 문서 탭** (시안 안 A): 가운데 최대 780px 문서. 제목 · 기간 부제 · 합계 띠 · 하루 막대(요일 7칸 —
  30일이면 날 수만큼, 새 이슈·완료·대화 세 색 쌓기, 범례) · workspace 절(절 머리에 그 workspace의 합계) ·
  칸마다 `완료 4` 같은 머리와 줄. 줄은 상태 알약 · 제목 · 오른쪽 날짜. 이슈 밑에 그 이슈의 대화가 왼쪽 선으로
  들여 붙는다(`4턴 · 38분`). 이슈 줄을 누르면 그 workspace로 가서 이슈를 연다(FR-19), 대화 줄을 누르면 그
  대화를 연다.
- **FR-17 요일 탭** (시안 안 B): workspace를 줄, 날을 칸으로 둔 격자. 칸 안의 사건은 아이콘(만듦 원 ·
  시작 삼각 · 완료 체크 · 대화 말풍선, 대화만 점선 테두리) + 제목 한 줄. 칸당 4개까지 보이고 나머지는
  `+N`(누르면 그 칸이 펼쳐진다). 사건을 누르면 오른쪽 300px 곁 칸에 그 이슈(또는 대화)의 시각과 이 기간의
  대화가 나오고 `이슈 열기`/`대화 열기`. 오늘 칸 머리는 `--accent-text`. 30일이면 칸이 30개라 가로로
  스크롤한다(칸 최소 120px).
- **FR-18 이슈 흐름 탭** (시안 안 C): workspace마다 대문자 머리, 그 아래 이슈 줄 = 상태 알약·제목 | 기간 축
  트랙(420px) | `대화 2 · 50분`. 맨 위에 고정된 축 머리(날짜 눈금)와 범례(만듦·시작·완료·대화). 막대는
  완료면 `--success-bg`, 아니면 `--accent-bg-strong`. 기간 전에 시작한 막대는 왼쪽 끝이 잘린 모양(둥글지
  않다)이다. 각 workspace의 마지막 줄은 `이슈 없는 대화`(트랙에 점만). 줄 순서는 완료 → 진행 중 → 나머지,
  각 안에서 마지막 사건 최신순.
- **FR-19** 이동: 리포트에서 이슈를 열면 `selectWorkspace(ws)` → `view='workspace'` → `openIn('issue', id)`.
  대화를 열면 인박스의 "대화 열기"와 같은 길(`openConversation`)이다. 리포트 조건은 App이 쥐고 있어
  돌아오면 그대로다.
- **FR-20** 상태: 불러오는 중이면 문서 자리에 뼈대 줄(스피너 없음), 오류면 `role="alert"` 배너와 `다시 시도`,
  비었으면 "이 기간에 손댄 이슈와 대화가 없습니다. 기간을 넓혀 보세요." + `지난 30일` 버튼. workspace가
  하나도 없으면 "workspace를 먼저 만드세요."
- **FR-21** 조건이 바뀌면 다시 만든다(250ms 디바운스, 늦게 온 응답은 버린다). run이 끝나거나 이슈·메모가
  바뀌면(`onRunUpdate`·`onItemChanged`) 리포트가 열려 있을 때만 다시 만든다.

### (D) 내보내기

- **FR-22 마크다운 복사**: `toMarkdown`의 결과를 클립보드에 넣고 버튼 곁에 `복사함`을 1.5초 보인다
  (`CopyButton`과 같다).
- **FR-23 메모로 저장**: 대상 workspace는 App의 `workspaceId`, 없으면 리포트에 담긴 첫 workspace다. 버튼 글자가
  대상을 말한다(`one-desk에 메모로 저장`). 메모 제목은 `리포트 2026-09-28 ~ 10-04`, 본문은 `toMarkdown`.
  저장하면 버튼 곁에 `저장함 · 메모 열기`가 뜬다. 같은 조건으로 두 번 누르면 메모가 둘 생긴다(막지 않는다 —
  고친 뒤 다시 저장하는 것이 흔하다).
- **FR-24 agent에게 다듬기**: 메모로 저장(FR-23)한 뒤 그 workspace로 가서(`selectWorkspace`), 그 메모를 맥락
  칩으로 담고, **새 대화 칸**을 열어 입력칸에 지시 초안을 채운다:
  `담은 리포트 메모를 바탕으로 팀에 공유할 주간 보고를 써 줘. 완료한 일, 진행 중인 일, 막힌 것 순서로.`
  **보내지는 않는다** — agent·권한·모델을 사람이 보고 보낸다. 초안은 App의 `draftPrompt` 길(인박스의 "다시
  실행"과 같다)이고 작업 디렉토리는 그 workspace의 기본(첫 repo)이다.
  - workspace를 넘는 데이터가 agent에게 가는 길은 이것 하나다 — 사람이 누른 버튼이 만든 메모 하나.
    agent는 그 메모를 MCP `get_memo`로도 읽을 수 있지만 그것은 원래부터 그 workspace의 메모다.

### (E) 진입점과 배선

- **FR-25** `App`의 `view`에 `'report'`가 더해진다. `Sidebar`에 `onSelectReport`가 **필수 prop**으로 더해진다
  (선택 prop이면 App의 한 줄을 지워도 조용히 컴파일된다 — CLAUDE.md "배선도 검증 대상").
- **FR-26** IPC: 채널 `reports:build` 하나, 핸들러는 `core.reports.build` 호출 한 줄. `OneDeskClient.reports.build`.

## 3. 인터페이스

```ts
// shared/models.ts
interface BuildReportInput { workspaceIds: string[]; since: number; until: number }
// ReportData·ReportIssue·ReportMemo·ReportConversation — FR-4 (+ ReportConversation.issueTitle: string | null)

// shared/client.ts
reports: { build(input: BuildReportInput): Promise<ReportData> }

// renderer/report/
period.ts     presetRange(preset, now) · customRange(from, to)            — FR-3
project.ts    classify · totals · attachConversations · runSeconds       — FR-6~9
days.ts       byDay                                                       — FR-10
track.ts      issueTrack                                                  — FR-11
markdown.ts   toMarkdown                                                  — FR-12
```

## 4. 화면 규칙

- 토큰만 쓴다(DESIGN.md). 새 토큰 없음 — 하루 막대의 세 색은 `--neutral`·`--success`·`--accent-border`.
- 숫자는 `tabular-nums`. 날짜는 `10-02(금)` 한 형식(`renderer/report/format.ts`).
- 아이콘은 `icons.tsx`에 `IconChart`·`IconCircle`·`IconPlay`·`IconChat`을 더한다(유니코드 글리프 금지).
- 상태 알약은 기존 `.status-<enum>` 이슈 상태 표를 쓴다 — 이슈 상태 이름을 새로 적지 않는다.
- 패널 안의 스크롤은 문서 영역·격자·흐름 목록만. 헤더와 조건 열은 고정.
- 1280px 아래에서 문서 탭의 조건 열은 띠로 바뀐다(요일·흐름과 같은 모양).

## 5. 비기능 요구사항

- **NFR-1** 경계 셋을 지킨다. `core/period/`·`core/reports/`는 electron을 모른다. 렌더러는 core를 import하지 않는다.
- **NFR-2** 지난 30일 · workspace 다섯 · 이슈 500 · run 2,000에서 `build`가 100ms 안(메인 프로세스에서 돈다 —
  MCP 서버가 같이 있다). 동기 SQLite 읽기만 하고 로그 파일은 읽지 않는다.
- **NFR-3** 새 이름의 부분 일치: `리포트`·`문서`·`요일`·`이슈 흐름`·`마크다운 복사`·`메모로 저장`·
  `agent에게 다듬기`. 기존 e2e의 `{ name: '이슈' }`류 부분 일치와 부딪히지 않는지 e2e를 먼저 돌린다.
  탭은 `role="tab"`이라 버튼 셀렉터와 갈린다.
- **NFR-4** 리포트는 agent의 답(`lastAnswer`)을 품는다 — 화면에서는 평문으로 그리고, 메모의 읽기 화면은
  기존 `Markdown` 규칙을 탄다.

## 6. 우려 사항 (Areas of concern)

1. **"완료"가 거짓일 수 있다.** 기간 안에 done → 다시 열림 → 기간 뒤 done이면 `closedAt`이 기간 밖이라 완료에
   없다. 반대로 기간 안에 done이었다가 지금 다시 열려 있으면 FR-6의 "지금 status가 done" 조건 때문에 빠진다.
   활동 기록 없이 고칠 수 없다 — 안내문으로 알린다. **결정(2026-10-07): 받아들인다.**
2. **진행 중은 "지금"이다.** 지난달 리포트를 보면 지금 doing인 것이 진행 중으로 보인다. 같은 안내문.
3. **메모 저장은 workspace를 넘는 데이터를 한 workspace에 남긴다.** 회사 workspace의 이슈 제목이 개인
   workspace의 메모에 들어갈 수 있다. 사람이 누른 것이고 버튼 글자가 대상을 말하지만, 그 workspace의 agent가
   그 뒤로 MCP `list_memos`로 읽을 수 있다. 막지 않는다 — 판단을 사용자에게 둔다.
4. **이슈 흐름 탭은 이슈가 많으면 길다.** 지난 30일에 이슈 수백이면 줄 수백이다. 1차는 가상화 없이 그린다.
5. **세 탭 유지 비용.** 같은 데이터의 세 투영이라 하나를 고치면 셋을 본다. 투영을 순수 함수로 떼어 두는
   것이 그 비용을 줄이는 방법이다.

## 7. 검증

- 단위(core): `core/period/`로 옮긴 뒤 MCP 테스트가 그대로 초록. `reports.build`가 workspace를 넘어 고르고,
  없는 id를 건너뛰고, 다른 workspace의 run이 섞이지 않는다.
- 단위(renderer): `period`(월요일 경계·지난주·끝날 포함·DST 없음), `classify`의 칸 우선순위와 경계(`until`은
  제외), `runSeconds`(끝나지 않은 턴 0), `byDay`(여러 날 대화), `issueTrack`(기간 전 시작 클립·30일 눈금),
  `toMarkdown`(빈 칸 생략·줄바꿈 접기·이스케이프 안 함).
- 컴포넌트: 탭을 바꿔도 조건이 남는다. `agent에게 다듬기`가 메모를 만들고 `onPolish(memo)`를 부른다.
- 배선(App.test): 사이드바 `리포트` → 리포트 화면, 이슈 줄 → 그 workspace의 이슈 열림, `agent에게 다듬기` →
  새 대화 칸에 초안과 메모 칩.
- e2e `e2e/report.e2e.ts`: workspace 둘에 이슈·대화를 만들고(가짜 CLI) 리포트를 연다 → 세 탭에서 두 workspace가
  보인다 → 복사한 글이 두 workspace 절을 담는다(클립보드는 `finally`에서 되돌린다) → 메모로 저장 → `agent에게
  다듬기`가 새 대화 칸에 메모 칩과 초안을 채우고 **보내지 않는다**.
- 실제 앱 캡처(라이트·다크) 세 탭.
