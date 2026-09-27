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
- **강조(파랑)**: 주 동작 버튼과 선택 상태에만. 선택된 탭·카드·칩은 `--accent-bg` 배경에
  `--accent-border` 테두리. 파란 글자(`--accent-text`)는 "골라진 것"뿐이다 — 답 안의 링크는
  파란 글자가 아니라 밑줄로 가르고 hover에서만 파랗다. 사용자 버블의 바탕(`--accent-bg`)은
  "내가 한 말"을 가르는 면이지 선택 상태가 아니다.
- **상태색**: 빨강(`--danger-*`)은 오류·삭제·취소, 노랑(`--warn-*`)은 경고·답변 필요,
  초록(`--success-*`)은 성공. 훑기 배너와 오래된 asset은 주황(`--attention-rgb`)이다.
  상태색은 배경 틴트 + 진한 글자 조합으로만 쓰고 채도 높은 면을 넓게 깔지 않는다.

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
사이드바(236px 고정) + 본문(flex) + 아래 도크. 사이드바는 인박스 · workspace 목록이고, 고른
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

- **버튼**: 주 동작만 파란 면이다 — 입력 카드의 전송(`.run-start`, 28px 원)과 설정 절의 저장.
  나머지는 흰 배경 + 테두리. 모든 버튼에 hover·active·focus-visible·disabled가 있다. disabled는
  `opacity: .4` — **글자를 흐리는 데 opacity를 쓰지 않는다**(쓰는 곳은 disabled와, hover·포커스에
  드러나는 줄 끝 아이콘의 0/1뿐이다). 흐린 글자는 토큰(`--text-muted`/`--text-secondary`)이다. Chromium이 disabled `<select>`를 통째로 반투명하게 그리므로 잠긴 알약은
  `opacity: 1`로 그 흐림을 걷고 토큰으로 흐린다.
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
