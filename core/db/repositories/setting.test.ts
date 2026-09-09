import { describe, it, expect, beforeEach } from 'vitest'
import { makeTestDb } from './testing'
import { eq } from 'drizzle-orm'
import { appSetting } from '../schema'
import {
  createSettingRepository, CONCURRENCY_LIMIT_KEY, DEFAULT_CONCURRENCY_LIMIT,
  GLOBAL_ROOTS_CLAUDE_KEY, GLOBAL_ROOTS_OPENCODE_KEY
} from './setting'
import type { Database } from '../open'

const HOME = '/tmp/fake-home'

describe('SettingRepository', () => {
  let db: Database
  let settings: ReturnType<typeof createSettingRepository>

  beforeEach(() => {
    db = makeTestDb()
    settings = createSettingRepository(db, HOME)
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
    expect(createSettingRepository(db, HOME).concurrencyLimit()).toBe(5)
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

describe('글로벌 asset 경로', () => {
  let db2: Database
  let settings2: ReturnType<typeof createSettingRepository>

  beforeEach(() => {
    db2 = makeTestDb()
    settings2 = createSettingRepository(db2, HOME)
  })

  it('저장한 적 없으면 홈 기준 기본값을 준다', () => {
    // core는 홈을 스스로 알지 않는다 — 인자로 받은 값으로만 기본값을 만든다.
    expect(settings2.globalRoots()).toEqual({
      claude: [`${HOME}/.claude/skills`, `${HOME}/.claude/agents`],
      opencode: [`${HOME}/.config/opencode/agent`]
    })
  })

  it('저장하면 그대로 돌려준다', () => {
    settings2.setGlobalRoots({ claude: ['/a', '/b'], opencode: ['/c'] })
    expect(settings2.globalRoots()).toEqual({ claude: ['/a', '/b'], opencode: ['/c'] })
  })

  it('빈 목록을 저장하면 기본값으로 돌아간다', () => {
    // 다 지웠을 때 아무것도 안 훑는 것보다 기본값으로 복귀하는 편이 낫다 —
    // 실수로 지운 사람이 앱을 못 쓰게 되지 않는다.
    settings2.setGlobalRoots({ claude: [], opencode: [] })
    expect(settings2.globalRoots().claude).toEqual([
      `${HOME}/.claude/skills`, `${HOME}/.claude/agents`
    ])
  })

  it('빈 줄과 앞뒤 공백을 버린다', () => {
    settings2.setGlobalRoots({ claude: ['  /a  ', '', '   ', '/b'], opencode: ['/c'] })
    expect(settings2.globalRoots().claude).toEqual(['/a', '/b'])
  })

  it('줄바꿈으로 구분해 저장한다', () => {
    settings2.setGlobalRoots({ claude: ['/a', '/b'], opencode: ['/c'] })
    const row = db2.select().from(appSetting)
      .where(eq(appSetting.key, GLOBAL_ROOTS_CLAUDE_KEY)).get()
    expect(row?.value).toBe('/a\n/b')
    const row2 = db2.select().from(appSetting)
      .where(eq(appSetting.key, GLOBAL_ROOTS_OPENCODE_KEY)).get()
    expect(row2?.value).toBe('/c')
  })
})
