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
    fontFamily: "ui-monospace, monospace"
    fontSize: "0.6875rem"
    lineHeight: 1.55
rounded:
  sm: "4px"
  md: "5px"
  lg: "7px"
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
    backgroundColor: "{colors.accent-bg}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "3px 8px"
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
- **강조(파랑)**: 주 동작 버튼과 선택 상태에만. 선택된 탭·카드·칩은 `--accent-bg` 배경에
  `--accent-border` 테두리. 파란 글자(`--accent-text`)는 "골라진 것"과 도구 호출 로그뿐.
- **상태색**: 빨강(`--danger-*`)은 오류·삭제·취소, 노랑(`--warn-*`)은 경고·답변 필요,
  초록(`--success-*`)은 성공. 훑기 배너와 오래된 asset은 주황(`--attention-rgb`)이다.
  상태색은 배경 틴트 + 진한 글자 조합으로만 쓰고 채도 높은 면을 넓게 깔지 않는다.

## Typography

한 가족(`system-ui`)만 쓴다. 코드·경로·로그는 `ui-monospace`. 크기는 rem이고
0.625 / 0.6875 / 0.75 / 0.8125 / 0.875 / 0.9375rem 여섯 단계다. 대문자 라벨(패널 제목,
사이드바 구분, 실행 설정의 칸 이름)은 0.6875rem에 자간 0.07em, 굵게. 제목을 위한 별도
디스플레이 서체는 없다.

## Layout

회색 캔버스(`--bg-canvas`) 위에 흰 패널(`--bg`)이 놓인다 — 사이드바는 캔버스 색 그대로다.
패널·도크는 10px 모서리와 1px 테두리, 아주 약한 그림자(`--shadow-panel`) 하나로 떠 있다.
사이드바(236px 고정) + 본문(flex) + 아래 도크. 사이드바는 인박스 · workspace 목록이고, 고른
workspace 아래에 그 workspace의 repo가 트리처럼 들여쓰기로 붙는다(등록 폼은 "repo 등록"으로 펼친다).
본문은 곧바로 세 패널이다. 본문 세 컬럼은 고른 패널이 3배로 넓어진다.
간격은 4·6·8·12px 네 단계. 고정 폭은 사이드바와 `panel-split-list`(200px)뿐이고 나머지는
`min-width: 0`으로 줄어든다. 항목을 열면 그 패널이 남는 폭을 다 쓰고 그 패널 안에는 상세만 남으며(목록은 숨는다), 나머지 둘은 180px 제목 목록 열로 남는다(1280px 아래에서는
숨는다. 축소 아이콘·Esc로 돌아온다). 상세는 가운데 정렬에 최대 1400px, 제목 1.375rem, 본문 0.9375rem/1.65이고 상태·축·repo는 한 줄이다.
스크롤은 목록·로그·도크 본문 같은 **내용 영역만** 한다 —
헤더와 입력부는 밀려나지 않는다.

## Elevation & Depth

평면이 기본이다. 그림자는 최상위 레이어에 뜨는 것(슬래시 피커) 하나만 갖고, 오프셋과
부드러운 블러를 함께 쓴다(`0 6px 18px rgba(0,0,0,.12)`). 카드 안에 카드를 두지 않는다.

## Shapes

모서리는 4(배너·작은 알약) / 5(입력·버튼·탭) / 6(실행 버튼·피커) / 7px(패널·카드).
칩과 상태 배지는 완전한 알약(`99px` 또는 높이의 절반).

## Components

- **버튼**: 주 동작(`.run-start`)만 파란 면이고 나머지는 흰 배경 + 테두리. 모든 버튼에
  hover·active·focus-visible·disabled가 있다. disabled는 `opacity: .4`.
- **입력**: 흰 배경, `--border` 테두리, 5px 모서리. 포커스 링은 전역 `:focus-visible`이
  `--focus-ring` 2px로 그린다 — 브라우저 기본 링을 그대로 두지 않는다.
- **칩**: 맥락 칩(`.chip`)은 통째로 "빼기" 버튼이라 hover에서 빨간 톤으로 바뀐다.
  표시 전용 알약(`.applied-chip`·`.axis-chip`)은 회색 테두리에 `cursor: default`.
- **목록 줄**: 평소엔 배경이 없고 hover에 `--bg-muted`, 열린 줄(`.item-active`)은 `--accent-bg`.
  줄 오른쪽 끝의 읽기 전용 표식은 `.item-meta`에 모으고, 제목이 줄어들지 표식이 줄어들지 않는다.
- **개수 알약**: 패널 제목·그룹 헤더·asset 절 제목 옆의 `.panel-count`/`.group-count`. 괄호로
  쓰지 않는다.
- **상태 알약**: 점 + 글자(`.status::before`). 색만으로 가르지 않는다.
- **아이콘**: `renderer/components/icons.tsx`의 인라인 SVG(16 viewBox, 1.5px). 전부 장식이라
  버튼의 `aria-label`이 이름을 준다.
- **탭**: 도크 탭과 설정 탭은 같은 모양(`.dock-tab`/`.settings-tab`). 앱 안에서 탭이
  두 가지로 보이면 안 된다.
- **알림**: 오류는 `role="alert"` + `--danger-bg`, 상태 안내는 `role="status"` +
  `--bg-muted`. 문장은 문제와 다음 행동을 함께 말한다.
- **설정 화면**: 가운데 한 열(최대 760px). 탭은 분절 컨트롤(`.settings-tabs`), 탭 내용은 흰 카드,
  라벨은 칸 위에 작게, 관련 칸 둘은 `.settings-grid`로 한 줄. 절마다의 저장 버튼이 주 동작(파란 면)이고
  정보 탭의 폴더 열기만 보조 버튼이다.
- **오버레이**: 최상위 레이어(`popover`)와 anchor positioning으로 띄운다. 스크롤
  컨테이너 안에 `position: absolute`로 두지 않는다 — 잘린다.

## Do's and Don'ts

- 하세요: 새 색이 필요하면 토큰을 추가하고 다크 값도 같이 정한다.
- 하세요: 짧은 라벨을 붙이기 전에 기존 e2e 셀렉터의 부분 일치를 확인한다(CLAUDE.md).
- 하지 마세요: 아이콘 자리에 유니코드 글리프를 넣는 것. 인라인 SVG(`currentColor`,
  1.5px 스트로크)를 쓴다.
- 하지 마세요: 상태 전달이 아닌 장식 모션. 전환은 120ms 안팎의 색·테두리 변화까지다.
- 하지 마세요: 플랫폼에 없는 키 이름(⌘) 안내. `renderer/shortcut.ts`가 정한다.
