import { describe, it, expect, beforeEach } from 'vitest'
import { makeTestDb } from './testing'
import { appSetting } from '../schema'
import {
  createSettingRepository, CONCURRENCY_LIMIT_KEY, DEFAULT_CONCURRENCY_LIMIT
} from './setting'
import type { Database } from '../open'

describe('SettingRepository', () => {
  let db: Database
  let settings: ReturnType<typeof createSettingRepository>

  beforeEach(() => {
    db = makeTestDb()
    settings = createSettingRepository(db)
  })

  /** 검증을 우회해 망가진 값을 직접 심는다. */
  function poke(value: string) {
    db.insert(appSetting).values({ key: CONCURRENCY_LIMIT_KEY, value })
      .onConflictDoUpdate({ target: appSetting.key, set: { value } }).run()
  }

  it('저장된 값이 없으면 기본값이다', () => {
    expect(settings.concurrencyLimit()).toBe(DEFAULT_CONCURRENCY_LIMIT)
  })

  it('저장하면 그 값을 읽는다', () => {
    settings.setConcurrencyLimit(5)
    expect(settings.concurrencyLimit()).toBe(5)
    expect(createSettingRepository(db).concurrencyLimit()).toBe(5)
  })

  it('두 번 저장해도 행이 하나다', () => {
    settings.setConcurrencyLimit(2)
    settings.setConcurrencyLimit(4)
    expect(db.select().from(appSetting).all()).toHaveLength(1)
    expect(settings.concurrencyLimit()).toBe(4)
  })

  it('망가진 값이 저장돼 있으면 기본값으로 떨어진다', () => {
    // Number()는 빈 문자열을 0으로, 쓰레기를 NaN으로 조용히 흘린다.
    for (const bad of ['', '   ', 'abc', '0', '-1', '2.5', 'NaN', 'Infinity']) {
      poke(bad)
      expect(settings.concurrencyLimit()).toBe(DEFAULT_CONCURRENCY_LIMIT)
    }
  })

  it('1 미만이거나 정수가 아니면 저장을 거부한다', () => {
    for (const bad of [0, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => settings.setConcurrencyLimit(bad)).toThrow(/1 이상의 정수/)
    }
    expect(settings.concurrencyLimit()).toBe(DEFAULT_CONCURRENCY_LIMIT)
  })
})
