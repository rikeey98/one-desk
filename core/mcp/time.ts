/**
 * MCP가 내보내고 받는 시각 (`docs/sdlc/timestamps/` FR-4·FR-6).
 *
 * **내보내는 시각은 전부 시간대가 붙은 ISO다** — 모델은 epoch ms로 요일·"이번 주"를 계산하다 틀린다.
 * 시간대는 앱 프로세스의 것(사용자의 장비)이다.
 */

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0')
}

/** `2026-09-29T14:03:00.000+09:00`. null은 null — 모르는 시각을 지어내지 않는다 */
export function toIso(ms: number | null): string | null {
  if (ms === null) return null
  const d = new Date(ms)
  const offset = -d.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const abs = Math.abs(offset)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    + `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
    + `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * 기간 인자(`since`·`until`)를 ms로. 날짜만(`2026-09-28`)이면 **앱의 시간대로 그 날 0시**다 —
 * `Date.parse`는 날짜만인 문자열을 UTC 자정으로 읽어 한국에서는 아침 9시가 된다.
 * 못 읽으면 어느 인자인지 말하며 던진다(도구가 isError로 돌려준다).
 */
export function parseBound(value: string, name: string): number {
  const date = DATE_ONLY.exec(value)
  if (date) {
    const [year, month, day] = [Number(date[1]), Number(date[2]), Number(date[3])]
    const local = new Date(year, month - 1, day)
    if (local.getFullYear() === year && local.getMonth() === month - 1 && local.getDate() === day) {
      return local.getTime()
    }
  } else {
    const ms = Date.parse(value)
    if (Number.isFinite(ms)) return ms
  }
  throw new Error(`${name}를 읽지 못했습니다: "${value}" — 2026-09-28 같은 날짜나 ISO 날짜시각을 주세요`)
}
