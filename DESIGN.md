---
name: one-desk
description: workspace·repo·이슈·메모를 한 화면에서 다루고 CLI 코딩 agent를 헤드리스로 돌리는 데스크톱 도구의 화면 규칙
colors:
  bg: "#ffffff"
  bg-panel: "#fafafa"
  bg-muted: "#f4f4f5"
  bg-hover: "#e4e4e7"
  border: "#e4e4e7"
  border-strong: "#d4d4d8"
  text: "#18181b"
  text-secondary: "#52525b"
  text-muted: "#6b6b70"
  accent: "#2563eb"
  accent-strong: "#1d4ed8"
  accent-border: "#60a5fa"
  accent-bg: "#eff6ff"
  danger: "#dc2626"
  danger-text: "#991b1b"
  danger-bg: "#fee2e2"
  warn-text: "#92400e"
  warn-bg: "#fef3c7"
  success: "#16a34a"
  success-bg: "#d1fae5"
typography:
  body:
    fontFamily: "system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 700
    letterSpacing: "0.07em"
  meta:
    fontFamily: "system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 400
  code:
    fontFamily: "ui-monospace, \"Cascadia Mono\", Consolas, D2Coding, monospace"
    fontSize: "0.6875rem"
    lineHeight: 1.55
  answer:
    fontFamily: "system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.65
rounded:
  sm: "4px"
  md: "5px"
  control: "6px"
  lg: "7px"
  field: "8px"
  panel: "10px"
  pill: "99px"
spacing:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "#ffffff"
    rounded: "6px"
    padding: "5px 14px"
  button-primary-hover:
    backgroundColor: "{colors.accent-strong}"
  button-secondary:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "3px 9px"
  input:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "4px 6px"
  chip-context:
    backgroundColor: "{colors.accent-bg}"
    textColor: "{colors.text}"
    rounded: "11px"
    padding: "2px 9px"
  tab-selected:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "5px 14px"
  bubble-user:
    backgroundColor: "{colors.accent-bg}"
    textColor: "{colors.text}"
    rounded: "{rounded.panel}"
    padding: "8px 12px"
  composer-card:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.text}"
    rounded: "{rounded.panel}"
    padding: "8px 10px"
  pill-select:
    backgroundColor: "{colors.bg-muted}"
    textColor: "{colors.text}"
    rounded: "{rounded.pill}"
    padding: "0 8px"
  button-send:
    backgroundColor: "{colors.accent}"
    textColor: "#ffffff"
    rounded: "50%"
    size: "28px"
---

# one-desk

## Overview

one-desk는 사람이 **작업 중에** 쓰는 도구다(Operate). 화면은 목록·입력·실행 로그가 대부분이고,
사용자는 하루에 수십 번 같은 자리를 오간다. 그래서 브랜드보다 **익숙함과 일관성**이 앞선다 —
같은 동작은 어느 화면에서든 같은 모양이어야 하고, 강조는 "지금 골라진 것"과 "지금 눌러야
하는 것" 두 곳에만 쓴다.

값의 원본은 `renderer/index.css` 맨 위의 `:root` 토큰이다. 규칙 안에 hex를 직접 쓰지 않는다.
다크 스킴은 같은 이름의 값만 바꾸고 OS 설정(`prefers-color-scheme`)을 따른다.

## Colors

- **중립**: 흰 바탕(`--bg`) 위에 패널은 `--bg-panel`, 사이드바와 접힌 항목은 `--bg-muted`,
  호버는 `--bg-hover`. 테두리는 `--border`가 기본이고 점선·피커처럼 조금 더 보여야 하면
  `--border-strong`.
- **글자**: 본문 `--text`, 설명·메타 `--text-secondary`, 빈 상태 안내는 `--text-muted`.
  **안내문을 `opacity`로 흐리게 하지 않는다** — 4.5:1 아래로 떨어진다. 색 토큰을 쓴다.
- **강조(파랑)**: 주 동작 버튼(전송·저장·새 대화)과 선택 상태에만. 선택된 탭·카드·칩은 `--accent-bg` 배경에
  `--accent-border` 테두리. 파란 글자(`--accent-text`)는 "골라진 것"뿐이다 — 답 안의 링크는
  파란 글자가 아니라 밑줄로 가르고 hover에서만 파랗다. 사용자 버블의 바탕(`--accent-bg`)은
  "내가 한 말"을 가르는 면이지 선택 상태가 아니다.
- **상태색**: 빨강(`--danger-*`)은 오류·삭제·취소, 노랑(`--warn-*`)은 경고·답변 필요,
  초록(`--success-*`)은 성공. 훑기 배너와 오래된 asset은 주황(`--attention-rgb`)이다.
  상태색은 배경 틴트 + 진한 글자 조합으로만 쓰고 채도 높은 면을 넓게 깔지 않는다.
- **구문 강조**: 코드 칸의 편집기만 쓴다 — `--code-keyword`·`-string`·`-comment`·`-number`·`-function`·`-type`·
  `-tag`·`-property` 여덟. 라이트는 흰 바탕에서, 다크는 `--bg`에서 4.5:1을 넘는다. 편집기 테마
  (`renderer/components/code/editorTheme.ts`)도 색을 전부 `var(--…)`로 쓴다 — hex를 쓰면 그 자리만 다크에서 흰 채로 남는다.

## Typography

한 가족(`system-ui`)만 쓴다. 코드·경로·셸 출력·diff는 토큰 `--font-mono`
(`ui-monospace, "Cascadia Mono", Consolas, D2Coding, monospace`)이고 규칙 안에 글꼴 이름을 직접
쓰지 않는다 — Chromium은 Windows에서 `ui-monospace`를 풀지 못해 generic `monospace`로 가고, 한국어
Windows에서 그것은 GulimChe라 `.`이 `,`처럼, `\`가 `₩`로 보인다(`timeline.e2e`가 실제 글꼴을 묻는다).
UI 글자 속의 **경로와 mcp 도구 이름도 모노다** — 공용 클래스 `.path-text`·`.tool-name`(글꼴과 `.92em`만
바꾼다). `system-ui`는 한국어 Windows에서 Malgun Gothic이라 경로의 `\`를 `₩`로 그린다.
크기는 rem이고 0.625 / 0.6875 / 0.75 / 0.8125 / 0.875 / 0.9375rem 여섯 단계다(상세 제목 1.375rem만
예외). 대문자 라벨(패널 제목, 사이드바 구분, "이 대화에 담긴 것")은 0.6875rem에 자간 0.07em,
굵게. 대화록의 사용자 버블과 답은 0.875rem — 읽는 글자라 목록보다 한 단계 크다(답은 행간 1.65).
제목을 위한 별도 디스플레이 서체는 없다.

## Layout

회색 캔버스(`--bg-canvas`) 위에 흰 패널(`--bg`)이 놓인다 — 사이드바는 캔버스 색 그대로다.
패널·도크는 10px 모서리와 1px 테두리, 아주 약한 그림자(`--shadow-panel`) 하나로 떠 있다.
사이드바(236px 고정) + 본문(flex) + 아래 도크. 사이드바는 맨 위 화면 이동 묶음(인박스 · 리포트 — 아래 1px 선으로 끊는다) · workspace 목록 · 설정이고, 고른
workspace 아래에 그 workspace의 repo가 트리처럼 들여쓰기로 붙는다(등록 폼은 "repo 등록"으로 펼친다).
본문은 곧바로 세 패널이다.
간격은 4·6·8·12px 네 단계. 고정 폭은 사이드바와 `panel-split-list`(200px), 도크의 대화 목록 열(196px)뿐이고 나머지는
`min-width: 0`으로 줄어든다. 항목을 열면 그 패널이 남는 폭을 다 쓰고 그 패널 안에는 상세만 남으며(목록은 숨는다), 나머지 둘은 180px 제목 목록 열로 남는다(1280px 아래에서는
숨는다. 축소 아이콘·Esc로 돌아온다). 상세는 가운데 정렬에 최대 1400px, 제목 1.375rem, 본문 0.9375rem/1.65이고 상태·축·repo는 한 줄이다.
스크롤은 목록·상세 본문·대화록 같은 **내용 영역만** 한다 —
헤더와 입력부는 밀려나지 않는다.

도크는 본문 아래에 붙고 기본 높이는 창의 50%, 하한 280px이다(헤더 + 대화 헤더 + 입력 카드 +
대화록 두어 줄 — 입력부가 고정이라 그보다 짧으면 입력 카드가 잘린다). 안은 왼쪽 대화 목록 열(196px,
따로 스크롤)과 오른쪽 대화 칸이고, 대화 칸은 **대화 헤더(고정) · 대화록(스크롤) · 입력부(고정)**
세 층이다 — 대화 칸 자신(`.dock-main`)은 스크롤하지 않는다. 대화록과 입력부는 **같은 방식으로
잰다**: 좌우 24px 안쪽 여백 + `scrollbar-gutter: stable both-edges` + 그 안에 가운데 선 최대
`--conversation-width`(1280px) 열. 폭만 같게 계산하면 대화록에 스크롤바가 서는 순간 턴 열만
밀린다. 최대화하면 도크가 본문 전체 높이를 쓰고 세 패널은 **숨는다**(언마운트하지 않는다).

## Elevation & Depth

평면이 기본이다. 패널·도크·설정 카드는 떠 있음을 알리는 아주 약한 `--shadow-panel` 하나를
갖는다. 그 밖의 그림자는 최상위 레이어에 뜨는 것(슬래시 피커·대화 메뉴·사용량 팝오버)만 갖고,
토큰 `--shadow-overlay`(라이트 `0 6px 18px rgba(0,0,0,.12)`, 다크는 `.5` — 어두운 바탕에서 `.12`는
보이지 않는다) 하나를 같이 쓴다. 대화록 위에 뜨는 `최신으로 이동`은 최상위 레이어가 아니라 그림자
없이 테두리로 뜬다. 카드 안에 카드를 두지 않는다 — 입력 카드 안의 맥락 칩·알약은 상자가 아니라
알약이다.

## Shapes

모서리는 크기가 아니라 쓰임으로 고른다(`renderer/index.css`와 맞춘 목록이다).

- **4px** — 오류 배너(`.form-error`), 메뉴·피커의 항목, 인라인 코드.
- **5px** — 작은 버튼·입력칸(이름 바꾸기, 슬롯 상한), 도크 토글, 턴 끝줄의 버튼, 타임라인의 줄.
- **6px** — 목록 줄(workspace·repo·대화), 패널 헤더의 버튼, 설정 탭, 코드 블록·셸 출력·diff 상자,
  오버레이(슬래시 피커·대화 메뉴·사용량 팝오버).
- **7px** — 인박스 항목, 예약 칩과 입력부 안내.
- **8px** — 설정 칸·경고·상태 목록, 빈 상태, 이슈·메모 본문 편집기, 훑기 배너.
- **10px** — 떠 있는 판: 패널·도크·설정 탭 카드, 그리고 대화의 입력 카드와 사용자 버블.

칩·상태 알약·알약 선택·`최신으로 이동`은 완전한 알약(`99px` 또는 높이의 절반), 상태 점·전송
버튼·스피너는 원(`50%`)이다.

## Components

- **버튼**: 주 동작만 파란 면이다 — 입력 카드의 전송(`.run-start`, 28px 원), 설정 절의 저장, 그리고 도크 목록 맨 위의
  `새 대화`(`.dock-new`, 2026-10-01 — 점선 보조 버튼일 때는 빈 자리 표시처럼 읽혀 찾지 못했다. 목록 스크롤 밖에 고정이고,
  새 대화를 쓰는 중이면 `--accent-border` 바깥 고리로 가른다).
  나머지는 흰 배경 + 테두리. 모든 버튼에 hover·active·focus-visible·disabled가 있다. disabled는
  `opacity: .4` — **글자를 흐리는 데 opacity를 쓰지 않는다**(쓰는 곳은 disabled와, hover·포커스에
  드러나는 줄 끝 아이콘의 0/1뿐이다). 흐린 글자는 토큰(`--text-muted`/`--text-secondary`)이다. Chromium이 disabled `<select>`를 통째로 반투명하게 그리므로 잠긴 알약은
  `opacity: 1`로 그 흐림을 걷고 토큰으로 흐린다.
- **사이드바 화면 이동**(인박스·리포트·설정, `.nav-item`): 24px 아이콘 타일(7px, `--bg` + `--border` + `--shadow-panel`) + 500 글자.
  타일이 쉬는 동안에도 테두리를 가져 제목이 아니라 누르는 줄로 읽힌다 — 굵은 글자만 있던 "인박스"는 구획 제목처럼 보였다(2026-10-07).
  hover는 줄 `--bg-hover` + 타일 `--border-strong`, 선택은 줄 `--accent-bg` + 타일이 `--accent`로 찬다(아이콘 `--on-accent`).
  `aria-current="page"`. workspace 줄에는 타일이 없다 — 화면이 아니라 범위를 고르는 줄이다.
- **입력**: 흰 배경, `--border` 테두리, 5px 모서리. 포커스 링은 전역 `:focus-visible`이
  `--focus-ring` 2px로 그린다 — 브라우저 기본 링을 그대로 두지 않는다.
- **칩**: 맥락 칩(`.chip`)은 통째로 "빼기" 버튼이라 hover에서 빨간 톤으로 바뀐다.
  표시 전용 알약(`.applied-chip`·`.axis-chip`)은 회색 테두리에 `cursor: default`.
- **목록 줄**: 평소엔 배경이 없고 hover에 `--bg-muted`, 열린 줄(`.item-active`)은 `--accent-bg`.
  줄 오른쪽 끝의 읽기 전용 표식은 `.item-meta`에 모으고, 제목이 줄어들지 표식이 줄어들지 않는다.
- **개수 알약**: 패널 제목·그룹 헤더·asset 절 제목 옆의 `.panel-count`/`.group-count`. 괄호로
  쓰지 않는다.
- **상태 알약**: 점 + 글자(`.status::before`). 색만으로 가르지 않는다. 글자는
  `renderer/runStatus.ts`의 한국어 이름이다(`대기 중`·`실행 중`·`완료`·`실패`·`취소됨`·`중단됨`) —
  영어 enum이 화면에 나가지 않는다. 클래스(`.status-<enum>`)는 enum 그대로다. 도크 목록 줄의
  상태는 점 하나(`.status-dot`)이고 이름은 `aria-label`·`title`이 준다.
- **아이콘**: `renderer/components/icons.tsx`의 인라인 SVG(16 viewBox, 1.5px). 전부 장식이라
  버튼의 `aria-label`이 이름을 준다. 선이 아니라 면인 것은 중지(`IconStop` — 선 네모는
  체크박스로 읽힌다)와 `⋯`(`IconMore`)뿐이다. 값을 그리는 계기(컨텍스트 링)는 아이콘이 아니라
  그 컴포넌트 안의 SVG다. 펼침 꺾쇠는 돌아가 있을 뿐 움직이지 않는다.
- **탭**: 설정 화면의 분절 컨트롤(`.settings-tabs`) 한 가지뿐이다. 도크는 탭이 아니라 세로
  대화 목록(`.dock-conv`)이다.
- **알림**: 오류는 `role="alert"` + `--danger-bg`, 상태 안내는 `role="status"` +
  `--bg-muted`. 문장은 문제와 다음 행동을 함께 말한다.
- **설정 화면**: 가운데 한 열(최대 760px). 탭은 분절 컨트롤(`.settings-tabs`), 탭 내용은 흰 카드,
  라벨은 칸 위에 작게, 관련 칸 둘은 `.settings-grid`로 한 줄. 절마다의 저장 버튼이 주 동작(파란 면)이고
  정보 탭의 폴더 열기만 보조 버튼이다.
- **오버레이**: 최상위 레이어(`popover`)와 anchor positioning으로 띄운다. 스크롤
  컨테이너 안에 `position: absolute`로 두지 않는다 — 잘린다. 열렸을 때만 `display`를 준다
  (`:popover-open`) — 작성자 규칙이 닫힌 popover의 UA `display: none`을 덮으면 닫힌 채 인라인에
  그려진다. 그림자는 `--shadow-overlay`, 테두리는 `--border-strong`, 모서리 6px.

### 도크 목록의 repo 구획

`docs/sdlc/dock-repo-sections/`. 구획 머리(`.dock-section`)는 꺾쇠 · repo 이름(0.6875rem 700 `--text-muted`, **대문자로 바꾸지 않는다** —
repo 이름은 식별자다) · 개수 알약이고, 접힌 머리 오른쪽에 그 구획의 답변 필요·실행 중 점이 선다. 두 번째 머리부터 위에 6px와
`--border-faint` 선. `기타`가 늘 맨 아래다. 구획 안 줄의 메타에서는 repo 이름을 뺀다. 사이드바 거름이 걸리면 목록 맨 위에
`--accent-bg`/`--accent-border` 알약(`api 대화만` + 원형 ✕ `repo 거름 풀기`)이 서고 구획 머리는 없다.

### 기간 리포트

`docs/sdlc/period-report/`. 본문 전체를 쓰는 패널 하나이고 도크는 없다(인박스·설정과 같다). 사이드바 진입점은 인박스 바로 아래
`리포트`(인박스와 같은 줄 모양 + 막대 아이콘, 배지 없음).

- **헤더**: 제목 · 보기 탭 셋(`문서`·`요일`·`이슈 흐름`, `role="tab"` — 설정 탭과 같은 분절 모양을 작게) · 오른쪽에 `마크다운 복사`·
  `agent에게 다듬기`(보조) · `<workspace>에 메모로 저장`(주 동작, 파란 면 — 글자가 저장 대상을 말한다).
- **조건**은 세 보기가 같이 쓰는 한 컴포넌트다 — 문서 보기에서는 왼쪽 248px 열(프리셋 2×2 · 날짜 두 줄 · workspace 체크 ·
  담을 것), 요일·흐름에서는 헤더 아래 띠(분절 프리셋 · 날짜 · workspace 알약). 1280px 아래에서는 열이 띠처럼 눕는다(같은 DOM).
- **문서**: 가운데 최대 780px. 합계 띠(`--bg-panel` 8px) · 날마다 쌓은 막대(새 이슈 `--neutral`, 완료 `--success`, 대화
  `--accent-border` — 새 토큰 없음) · workspace 절(위 1px 선) · 칸 머리(대문자 라벨 + 개수 알약) · 줄(상태 알약 · 제목 ·
  오른쪽 날짜). 이슈의 대화는 왼쪽 1px 선으로 들여 붙고, 답 한 줄은 그 밑에 한 단 더 흐린 글자다. 끝에 상태 안내문(`--text-muted`).
- **요일**: workspace 줄 × 날 칸 격자, 머리 줄과 workspace 칸은 sticky. 사건은 아이콘 + 제목 한 줄(완료는 `--success-bg`, 대화는
  점선 테두리), 칸당 넷 + `+N`. 고른 사건은 `--accent-bg`/`--accent-border`. 오른쪽 260px 곁 칸이 자세히.
- **이슈 흐름**: 제목 | 트랙(최대 420px) | 대화 수·시간의 세 칸 격자. 트랙은 점선 축 + 날(또는 주) 눈금, 막대는 완료면
  `--success-bg` 아니면 `--accent-bg-strong`(8px 알약 — 기간 전에 시작했으면 왼쪽 모서리가 각지다), 표식은 만듦(빈 원)·시작
  (`--accent` 원 + 삼각)·완료(`--success` 원 + 체크), 대화 턴은 5px 점. 끝나지 않은 막대는 지금에서 멈춘다.
- 날짜는 `10-02(금)` 한 형식, 숫자는 `tabular-nums`. 이슈 상태 알약은 목록과 같은 `.status-<enum>` 글자 그대로다.

### 대화 화면

`docs/sdlc/conversation-timeline/`. OpenCode Desktop의 세션 화면처럼 읽힌다 — 오른쪽 사용자 버블,
왼쪽 마크다운 답, 활동은 한 줄 묶음, 입력은 바닥에 고정된 카드. 치수는 그 spec의 §4다.

- **도크 헤더**: 토글(꺾쇠 + "대화", 이름은 `대화창 숨기기`/`대화창 보이기`) · 슬롯 표시기 ·
  오른쪽 끝의 최대화 한 단추(`대화창 최대화`/`대화창 원래 크기로` — 이름과 아이콘만 바뀐다).
  **토글 이름에 "실행"·"접기"를, 최대화 이름에 "축소"를 넣지 않는다** — 전송 버튼·턴의 `접기`·패널의
  `축소`와 부분 일치로 부딪힌다. 도크 헤더에는 취소가 없다.
- **대화 헤더**: 제목(누르면 이름 바꾸기 — 버튼이 아니다, 키보드 경로는 메뉴) · `⋯` 메뉴(이름 바꾸기 ·
  대화 끝내기) · 부제(agent · repo 이름, 끝낸 대화면 "끝낸 대화") · 오른쪽에 `멈추기`(도는 턴이 있고
  **입력칸에 초안이 있을 때만**, 경고 톤 — 입력칸이 비면 입력부의 중지가 그 자리다)와 컨텍스트 링(18px,
  선 2px, 바탕 `--border-strong`·채움 `--accent`의 끝이 둥근 호 — 낮은 점유에도 점이 아니라 짧은 호, 80%를
  넘으면 `--warn`)과 곁의 퍼센트 글자(`5%`, 0.6875rem `--text-secondary`).
  둘째 줄은 "이 대화에 담긴 것"(한 줄, 넘치면 잘리고 전체는 `title`). **돈은 링을 눌러야 보인다**
  (사용량 팝오버) — 화면에 비용을 상시 띄우지 않는다.
- **대화록**: 턴 간격 24px, 턴 안 간격 8px. 사용자 버블은 오른쪽(최대 80%, `--accent-bg`, 10px,
  평문 — 사람이 친 `*`·`#`이 뜻을 바꾸지 않는다). 답 칸은 **버블 없이** 왼쪽이다. 턴은 **전부 접힌 채
  시작한다** — 접힌 턴은 버블 · 상태 줄(진행 중: 스피너 · 작업 중 · 경과 시간 · 지금 도는 도구 ·
  멈추기) · 활동 요약 한 줄("도구 7회 · 실패 1") · 답 칸 · 오류 카드 · 끝줄이다. 끝줄은 상태 알약 ·
  메타 조각(`agent · 모델 · 22초 · effort · 권한`, 구분점은 `::before`라 빠진 조각 앞뒤에 점이 남지
  않는다, 정확한 토큰·비용은 `title`) · `응답 복사` · `다시 보내기`/`답하기` · `자세히`. **시간은 한 번만
  말한다** — 도는 동안은 상태 줄이, 끝나면 메타 조각이. 요청한 모델이나
  effort가 앞 턴과 다르면 버블 위에 양옆 가는 선의 가운데 공지("모델 → opus")가 선다.
- **펼친 턴의 블록**: 중간 텍스트(마크다운) · 활동 묶음(한 줄 라벨 "4 읽기, Grep, 셸 사용됨" — mcp 도구는
  이름만 모노로 "1 list_issues 사용됨", 누르면 24px 도구 한 줄들 — 셸은 펼치면 명령과 출력) · 실패한 도구(묶음 밖에 따로, `--danger-bg-soft` 한 줄,
  "실패" 글자) · 편집(파일 줄 + `+N −M`, 펼치면 diff — 추가 `--success-bg`, 삭제 `--danger-bg-soft`,
  부호 칸이 따로라 색만으로 가르지 않는다). 셸 출력과 diff는 `--bg-muted` 6px 상자에서 최대 240px로
  스크롤한다. **도구의 입력·출력은 평문이다.** 잘린 출력에는 "출력 앞부분만 기록됩니다"를 붙인다 —
  잘린 것을 전부인 것처럼 보이지 않는다. 펼칠 것이 없는 줄은 버튼이 아니라 글자다. **펼침 꺾쇠는 글자
  바로 뒤다**(묶음·도구·실패 줄) — 파일 줄만 오른쪽 끝, `+N −M` 곁이다. 오른쪽으로 민 곁 글자(하위
  에이전트의 종류)는 꺾쇠 뒤에 선다.
- **마크다운**(답 칸과 중간 텍스트뿐): 링크는 밑줄로 가른다(파란 글자는 "골라진 것"의 색이다). http(s)가
  아닌 주소는 점선 밑줄 글자이고 원래 주소는 `title`이다. 이미지는 그리지 않고 `[이미지: alt]` 글자다.
  원시 HTML은 모노 글자 블록으로 보인다. 코드 블록은 `--bg-muted` 6px에 머리(언어 이름 · `코드 복사`)가
  붙고 가로 스크롤은 블록 안에서만, 넓은 표도 제 상자 안에서만 스크롤한다 — 대화록 전체를 옆으로 밀면
  안 된다. 제목은 h1·h2 0.9375rem, 그 아래 0.875rem, 전부 600.
- **입력부**: 도크 바닥에 고정된 **카드 하나**(`--bg`, 1px `--border-strong`, 10px, `:focus-within`이면
  `--accent-border`). 카드 밖 위에 오류와 예약 칩(`--bg-muted` 7px, `대기 중` · 지시 첫 줄 · 이유 ·
  `예약 취소`, `role="status"`). 카드 안은 맥락 칩 줄(**담은 것이 있을 때만** — 빈 안내 줄은 없다, 두 줄
  높이에서 스크롤 — 카드가 대화록을 밀면 안 된다) · 테두리 없는 입력칸(한 줄에서 시작해 쓰는 만큼 160px까지)
  · 알약 줄(22px 알약 다섯 — agent · 모델 · effort/variant · 권한 · 작업 디렉토리 — 와 오른쪽 끝 28px 원
  전송). 이어 가는 대화의 작업 디렉토리 알약은 repo 이름이고 경로는 `title`과 곁의 복사 버튼이다(경로를
  값으로 두면 좁은 알약이 앞부분만 남긴다). 대화에 도는 턴이 있고
  입력이 비었으면 같은 자리의 전송이 **중지**(채운 네모)가 된다. 알약의 보이는 글자와 접근성 이름은
  다르다 — 이름은 `aria-label`이 주고 `<label>`로 `<select>`를 감싸지 않는다(옵션 글자가 이름에
  빨려 든다). 값이 비면 "기본값"만 보이므로 effort·variant·모델 알약은 칸 이름을 머리(600)로 단다.
  placeholder도 `--text-muted`다 — UA 기본색은 `--bg-muted` 위에서 4.5:1이 안 된다.
- **대화록만 스크롤한다.** 바닥(24px 안)에 붙어 있으면 새 내용을 따라 내려가고, 위로 올려 두면 대화록
  아래 가운데에 `최신으로 이동` 알약이 뜬다(스크롤러의 형제라 함께 스크롤되지 않는다). 사용자가 펼치고
  접은 것으로는 움직이지 않는다.
- **움직임**: 상태 줄과 도는 도구 한 줄의 스피너 하나뿐이다(12px 원, 0.8초 회전). 묶음·편집 머리에는
  달지 않는다. `prefers-reduced-motion: reduce`면 돌지 않는 점이다.

### 코드 칸

`docs/sdlc/code-editor/`. Claude Code 데스크톱의 상단 버튼처럼 **대화 헤더 오른쪽 끝**의 버튼 줄(지금은 `파일` 하나 —
변경사항·터미널이 같은 줄에 붙는다)이 **앱 창 오른쪽 끝에 위아래 전체 높이**로 칸을 연다(안 B, 2026-10-10): 사이드바 · 본문 ·
9px 경계 · 칸(10px 모서리·1px 테두리·`--shadow-panel`의 패널 카드, 열의 위·아래·오른쪽 여백 12px는 본문과 같다). 칸은 기본으로
사이드바를 뺀 창 폭의 40%이고 경계를 끌어 바꾼다(칸 320px · 본문 560px 아래로 줄지 않는다, 둘을 다 못 지키면 칸이 이긴다).
도크를 접어도 칸은 남고, 인박스·설정·리포트에는 없다.

- **버튼**(`.pane-toggle`): 24px, 5px 모서리, 1px 테두리의 보조 버튼에 아이콘 + 글자. 열려 있으면 `--accent-bg` 면에
  `--accent-text` — 눌림(`aria-pressed`)이 상태를 말한다. 대상 repo가 없으면 `aria-disabled`(`--bg-muted`)이고 이유는
  `title`이다 — `disabled`를 쓰면 풍선이 뜨지 않는다.
- **칸 머리**: repo 이름(600) · 연 파일 경로(모노, 넘치면 말줄임, 전체는 `title`) · 저장하지 않음 점(7px `--warn` 원 — 글리프가
  아니다) · 상태 글자(`저장 중…`·`저장됨`) · 오른쪽에 `저장하지 않은 파일 N`(`--warn-text`) · `저장`(주 동작이라 파란 면,
  고친 것이 없으면 `--bg-muted`) · `버리기`(두 번 누르기) · 새로고침 · 닫기.
- **알림 줄**(머리 아래, 4px): 섞인 줄바꿈은 `--bg-muted`, 디스크에서 바뀜·지워짐은 `--warn-bg`. 저장 충돌은 이슈 본문과 같은
  `.conflict-banner`(`디스크 내용 불러오기` · `내 것으로 덮어쓰기`).
- **트리**: 칸의 왼쪽 열 `clamp(140px, 32%, 260px)`, 따로 스크롤. 위에 찾기 칸, 줄은 22px(폴더 꺾쇠 · 파일 아이콘 · 이름,
  깊이마다 0.75rem 들여쓰기), 연 파일은 `--accent-bg`. 저장하지 않은 파일은 줄 끝에 6px 점. 찾기 칸에 치면 트리 대신
  `@` 피커와 같은 퍼지 결과(경로 전체, 모노)다.
- **편집기**: CodeMirror 6, 0.75rem 모노, 줄 번호 칸은 `--bg-panel`, 현재 줄은 `--bg-muted`, 선택은 `--accent-bg-strong`,
  찾기 일치는 `--warn-bg`. 마크다운 파일도 원문이다.
- **대화록의 `코드 칸에서 열기`**: 편집 파일 줄 오른쪽의 22px 아이콘(바깥 링크). 칸의 repo 안 경로일 때만 선다.
- **닫기 확인**: 앱에서 **하나뿐인 모달**이다 — 저장하지 않은 고침이 있는데 창을 닫을 때만 뜬다(Electron은 막힌 닫기에
  대화상자를 띄우지 않는다). `--neutral-rgb` 35% 막 위에 440px 판(10px, `--shadow-overlay`), 제목 0.9375rem, 버튼 셋
  (`모두 저장하고 닫기`가 파란 면). 저장하지 못한 파일은 그 안에 `--danger-bg` 목록으로 남는다.

## Do's and Don'ts

- 하세요: 새 색이 필요하면 토큰을 추가하고 다크 값도 같이 정한다.
- 하세요: 짧은 라벨을 붙이기 전에 기존 e2e 셀렉터의 부분 일치를 확인한다(CLAUDE.md).
- 하지 마세요: 아이콘 자리에 유니코드 글리프를 넣는 것. 인라인 SVG(`currentColor`,
  1.5px 스트로크)를 쓴다.
- 하지 마세요: 상태 전달이 아닌 장식 모션. 전환은 120ms 안팎의 색·테두리 변화까지다.
- 하지 마세요: 플랫폼에 없는 키 이름(⌘) 안내. `renderer/shortcut.ts`가 정한다.
- 하지 마세요: agent 출력(답·도구 입력·출력)을 HTML로 그리는 것. 답의 마크다운은 원시 HTML을 글자로
  두고, 링크는 http(s)만, 이미지는 그리지 않는다(CLAUDE.md).
- 하지 마세요: 대화 영역에 글자 흐림용 `opacity`. `--text-muted`/`--text-secondary`를 쓴다.
