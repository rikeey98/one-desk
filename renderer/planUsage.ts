import type { PlanUsage, PlanWindow } from '@shared/models'

/** 컨텍스트 링과 같은 문턱이다 — 넘으면(같으면 아니다) 경고색 */
const WARN_UTILIZATION = 0.8

export interface PlanUsageView {
  /** 사이드바 한 줄 — `요금제 5h 6% · 7d 2%` */
  label: string
  /** 창마다 리셋 시각과 마지막 확인 시각 */
  title: string
  warn: boolean
}

function percent(utilization: number): string {
  if (utilization > 0 && utilization < 0.01) return '<1%'
  return `${Math.round(utilization * 100)}%`
}

function ago(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return '방금'
  if (minutes < 60) return `${minutes}분 전`
  return `${Math.floor(minutes / 60)}시간 전`
}

function resetText(at: number): string {
  return new Date(at).toLocaleString('ko-KR', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
  })
}

/**
 * 요금제 사용률의 표시 (`docs/sdlc/plan-usage/` FR-5). 순수 함수라 시계를 인자로 받는다.
 *
 * **리셋 시각이 지난 창은 `—`다** — 그 뒤에 쓴 양을 모르므로 옛 수치를 보이면 거짓이다. 경고에서도
 * 빠진다. 모르는 창(null)은 줄에서 뺀다.
 */
export function planUsageView(usage: PlanUsage, now: number): PlanUsageView {
  const windows: Array<[short: string, long: string, w: PlanWindow | null]> = [
    ['5h', '5시간', usage.fiveHour],
    ['7d', '7일', usage.sevenDay]
  ]
  const parts: string[] = []
  const lines: string[] = []
  let warn = usage.limited
  for (const [short, long, w] of windows) {
    if (!w) continue
    if (w.resetsAt <= now) {
      parts.push(`${short} —`)
      lines.push(`${long} 한도 — 리셋됨. 그 뒤의 사용량은 다음 실행에서 보입니다`)
      continue
    }
    parts.push(`${short} ${percent(w.utilization)}`)
    lines.push(`${long} 한도 ${percent(w.utilization)} — ${resetText(w.resetsAt)} 리셋`)
    if (w.utilization > WARN_UTILIZATION) warn = true
  }
  if (usage.limited) parts.push('한도 도달')
  lines.push(`마지막 확인 ${ago(now - usage.observedAt)} (claude 실행 때마다 갱신)`)
  return { label: `요금제 ${parts.join(' · ')}`, title: lines.join('\n'), warn }
}
