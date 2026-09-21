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

export function IconFolder(props: SVGProps<SVGSVGElement>) {
  return <Icon {...props}><path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3l1.5 1.5h4.5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z" /></Icon>
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
