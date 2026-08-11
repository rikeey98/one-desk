import { eq } from 'drizzle-orm'
import type { Database } from '../open'
import { appSetting } from '../schema'

/** 동시 실행 상한을 담는 키 */
export const CONCURRENCY_LIMIT_KEY = 'run.concurrencyLimit'

/** 설계 §6이 정한 기본 상한 */
export const DEFAULT_CONCURRENCY_LIMIT = 3

/** 1 이상의 정수만 상한으로 받는다. */
function isValidLimit(n: number): boolean {
  return Number.isInteger(n) && n >= 1
}

export function createSettingRepository(db: Database) {
  return {
    /**
     * 저장된 동시 실행 상한.
     * 값이 없거나 망가졌으면 기본값으로 떨어진다 — 상한이 0이나 NaN이 되면
     * 큐가 아무것도 시작하지 않고 조용히 멈춘다.
     */
    concurrencyLimit(): number {
      const row = db.select().from(appSetting)
        .where(eq(appSetting.key, CONCURRENCY_LIMIT_KEY)).get()
      if (!row) return DEFAULT_CONCURRENCY_LIMIT
      const n = Number(row.value)
      return isValidLimit(n) ? n : DEFAULT_CONCURRENCY_LIMIT
    },

    setConcurrencyLimit(n: number): number {
      if (!isValidLimit(n)) {
        throw new Error(`동시 실행 상한은 1 이상의 정수여야 합니다: ${n}`)
      }
      const value = String(n)
      db.insert(appSetting).values({ key: CONCURRENCY_LIMIT_KEY, value })
        .onConflictDoUpdate({ target: appSetting.key, set: { value } }).run()
      return n
    }
  }
}

export type SettingRepository = ReturnType<typeof createSettingRepository>
