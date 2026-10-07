import { DEFAULT_INCLUDE, type Include } from './markdown'

/**
 * 리포트 화면의 취향 — 마지막 보기 탭과 담을 것 (`docs/sdlc/period-report/` FR-15). 이 장비의 localStorage에 둔다
 * (`listWidth.ts`와 같은 방식). 기간·workspace는 남기지 않는다 — 다음에 열면 "지난주·전부"로 시작한다.
 */
export type ReportTab = 'document' | 'days' | 'flow'

export const REPORT_TABS: ReadonlyArray<{ id: ReportTab; label: string }> = [
  { id: 'document', label: '문서' },
  { id: 'days', label: '요일' },
  { id: 'flow', label: '이슈 흐름' }
]

const TAB_KEY = 'one-desk.report.tab'
const INCLUDE_KEY = 'one-desk.report.include'

function read(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function write(key: string, value: string): void {
  try { localStorage.setItem(key, value) } catch { /* 기억만 못 할 뿐이다 */ }
}

export function readTab(): ReportTab {
  const raw = read(TAB_KEY)
  return REPORT_TABS.some((t) => t.id === raw) ? (raw as ReportTab) : 'document'
}

export function writeTab(tab: ReportTab): void {
  write(TAB_KEY, tab)
}

/** 모르는 키·틀린 타입은 기본값으로 — 예전 버전이 남긴 값이 화면을 깨지 않게 */
export function readInclude(): Include {
  const raw = read(INCLUDE_KEY)
  if (raw === null) return DEFAULT_INCLUDE
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_INCLUDE
    const out = { ...DEFAULT_INCLUDE }
    for (const key of Object.keys(DEFAULT_INCLUDE) as Array<keyof Include>) {
      const v = (parsed as Record<string, unknown>)[key]
      if (typeof v === 'boolean') out[key] = v
    }
    return out
  } catch {
    return DEFAULT_INCLUDE
  }
}

export function writeInclude(include: Include): void {
  write(INCLUDE_KEY, JSON.stringify(include))
}
