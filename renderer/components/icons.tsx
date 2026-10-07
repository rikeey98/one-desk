import type { SVGProps } from 'react'

/**
 * 앱 안의 아이콘. 유니코드 글리프(✎ 🗑 ⧉ ▾) 대신 같은 굵기(1.5px)·같은 크기의 선으로
 * 그린다 — 글리프는 글꼴마다 모양과 굵기가 달라 한 줄에 놓이면 어긋난다(DESIGN.md).
 * 전부 장식이다: 뜻은 감싸는 버튼의 aria-label이 말하므로 aria-hidden으로 둔다.
 */
function Icon({ children, ...rest }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {children}
    </svg>
  )
}

export function IconPlus(props: SVGProps<SVGSVGElement>) {
  return <Icon {...props}><path d="M8 3v10M3 8h10" /></Icon>
}

export function IconChevronRight(props: SVGProps<SVGSVGElement>) {
  return <Icon {...props}><path d="M6 3.5 10.5 8 6 12.5" /></Icon>
}

export function IconChevronLeft(props: SVGProps<SVGSVGElement>) {
  return <Icon {...props}><path d="M10 3.5 5.5 8 10 12.5" /></Icon>
}

/**
 * 도크 토글 — 아래를 향한 꺾쇠(`docs/sdlc/conversation-timeline/` spec FR-37). 접힌 도크에서는
 * CSS가 뒤집어 위를 향하게 한다. 글리프 `▾`/`▴`를 대신한다(FR-48).
 */
export function IconChevronDown(props: SVGProps<SVGSVGElement>) {
  return <Icon {...props}><path d="M3.5 6 8 10.5 12.5 6" /></Icon>
}

/** 더 보기 — 가로 점 셋. 대화 헤더의 `⋯` 메뉴 단추다(FR-35). 점이라 선이 아니라 면이다. */
export function IconMore(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="3.5" cy="8" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12.5" cy="8" r="1.1" fill="currentColor" stroke="none" />
    </Icon>
  )
}

/** 최대화 — 두 화살표가 바깥을 향한다(FR-38). 되돌리기는 `IconCollapse`(안쪽을 향한다)다. */
export function IconMaximize(props: SVGProps<SVGSVGElement>) {
  return <Icon {...props}><path d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9" /></Icon>
}

/** 최신으로 이동 — 아래를 향한 화살표(FR-42). */
export function IconArrowDown(props: SVGProps<SVGSVGElement>) {
  return <Icon {...props}><path d="M8 3v10M3.5 8.5 8 13l4.5-4.5" /></Icon>
}

export function IconFolder(props: SVGProps<SVGSVGElement>) {
  return <Icon {...props}><path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3l1.5 1.5h4.5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z" /></Icon>
}

/** 파일 — 모서리가 접힌 종이. `@` 피커의 줄 머리다(docs/sdlc/input-triggers/ FR-2). */
export function IconFile(props: SVGProps<SVGSVGElement>) {
  return <Icon {...props}><path d="M4.5 2h4.5l3 3v8a1 1 0 0 1-1 1h-6.5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM9 2v3h3" /></Icon>
}

export function IconExternalLink(props: SVGProps<SVGSVGElement>) {
  return <Icon {...props}><path d="M9 3h4v4M13 3 7.5 8.5M12 9.5V12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h2.5" /></Icon>
}

export function IconPencil(props: SVGProps<SVGSVGElement>) {
  return <Icon {...props}><path d="m11.5 2.5 2 2L5 13H3v-2z" /></Icon>
}

export function IconTrash(props: SVGProps<SVGSVGElement>) {
  return <Icon {...props}><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 8.5h6l.5-8.5" /></Icon>
}

/** 확장된 패널을 원래 크기로 되돌리기 — 두 화살표가 안쪽을 향한다. */
export function IconCollapse(props: SVGProps<SVGSVGElement>) {
  return <Icon {...props}><path d="M13.5 2.5 9 7M9 3.5V7h3.5M2.5 13.5 7 9M7 12.5V9H3.5" /></Icon>
}

export function IconRefresh(props: SVGProps<SVGSVGElement>) {
  return <Icon {...props}><path d="M13 8A5 5 0 0 1 4.2 11.2M3 8a5 5 0 0 1 8.8-3.2M12 2.5v3h-3M4 13.5v-3h3" /></Icon>
}

/**
 * 대화 끝내기 — 체크다. ×를 쓰지 않는 것은 그것이 **삭제로 읽히기** 때문이다:
 * 대화를 끝내도 기록은 그대로 남고 "끝낸 대화"에서 다시 열 수 있다
 * (docs/sdlc/conversation-lifecycle/ plan §2).
 */
export function IconCheck(props: SVGProps<SVGSVGElement>) {
  return <Icon {...props}><path d="m3 8.5 3.5 3.5L13 4.5" /></Icon>
}

/**
 * 보내기 — 위를 향한 화살표. 입력 카드의 전송 버튼이다(`docs/sdlc/conversation-timeline/`
 * spec FR-28). 원 안에 그리므로 선만 있다.
 */
export function IconSend(props: SVGProps<SVGSVGElement>) {
  return <Icon {...props}><path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" /></Icon>
}

/**
 * 멈추기 — 채운 네모. 전송 버튼이 실행 중인 턴을 멈추는 버튼으로 바뀔 때 쓴다(FR-28).
 * 선이 아니라 면이라 `fill`을 준다 — 선 네모는 체크박스로 읽힌다.
 */
export function IconStop(props: SVGProps<SVGSVGElement>) {
  return <Icon {...props}><rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" stroke="none" /></Icon>
}

/** 빼기·닫기 — ×. 맥락 칩의 "빼기"처럼 **지우지 않고 치우는** 자리에만 쓴다(대화 끝내기는 체크다). */
export function IconClose(props: SVGProps<SVGSVGElement>) {
  return <Icon {...props}><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></Icon>
}

/** 복사 — 겹친 두 장. 복사가 끝나면 IconCheck로 잠깐 바뀐다(CopyButton). */
export function IconCopy(props: SVGProps<SVGSVGElement>) {
  return <Icon {...props}><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" /><path d="M10.5 5.5V4A1.5 1.5 0 0 0 9 2.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5" /></Icon>
}

/** 새 창으로 열기 — 창 하나 위에 겹친 창(docs/sdlc/item-windows/). 외부 링크(`IconExternalLink`)와 갈린다. */
export function IconNewWindow(props: SVGProps<SVGSVGElement>) {
  return <Icon {...props}><path d="M5 2.5h8.5V10M5 2.5V5M13.5 10H11" /><rect x="2.5" y="5" width="8.5" height="8.5" rx="1" /></Icon>
}

/** 사이드바의 `리포트` (`docs/sdlc/period-report/` FR-13) — 높이가 다른 막대 넷 */
export function IconChart(props: SVGProps<SVGSVGElement>) {
  return <Icon {...props}><path d="M3 13V8.5M6.5 13V4M10 13V6.5M13.5 13V10" /></Icon>
}

/** 리포트의 "만듦" 사건 */
export function IconCircle(props: SVGProps<SVGSVGElement>) {
  return <Icon {...props}><circle cx="8" cy="8" r="4.5" /></Icon>
}

/** 리포트의 "시작" 사건 — 면이다(선 삼각은 꺾쇠와 헷갈린다) */
export function IconPlay(props: SVGProps<SVGSVGElement>) {
  return <Icon {...props}><path d="M5.5 4v8l6.5-4z" fill="currentColor" /></Icon>
}

/** 리포트의 대화 사건 — 말풍선 */
export function IconChat(props: SVGProps<SVGSVGElement>) {
  return <Icon {...props}><path d="M3 4h10v6.5H7.5L4.5 13v-2.5H3z" /></Icon>
}

/** 날짜 칸 */
export function IconCalendar(props: SVGProps<SVGSVGElement>) {
  return <Icon {...props}><rect x="2.5" y="3.5" width="11" height="10" rx="1.5" /><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" /></Icon>
}

/** 다듬기 — 반짝임 하나 */
export function IconSparkle(props: SVGProps<SVGSVGElement>) {
  return <Icon {...props}><path d="M8 2.5 9.3 6.7 13.5 8l-4.2 1.3L8 13.5 6.7 9.3 2.5 8l4.2-1.3z" /></Icon>
}

/** 사이드바의 `인박스` — 받은 편지함 쟁반 */
export function IconInbox(props: SVGProps<SVGSVGElement>) {
  return <Icon {...props}><path d="M2.5 9h3l1 2h3l1-2h3" /><path d="M4 3.5h8l1.5 5.5v3.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V9z" /></Icon>
}

/** 사이드바의 `설정` — 조절 막대 둘(톱니는 16px에서 뭉개진다) */
export function IconSettings(props: SVGProps<SVGSVGElement>) {
  return <Icon {...props}><path d="M2.5 5h6M11.5 5h2M2.5 11h2M7.5 11h6" /><circle cx="10" cy="5" r="1.5" /><circle cx="6" cy="11" r="1.5" /></Icon>
}
