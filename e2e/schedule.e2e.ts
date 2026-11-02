import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import type { Page } from 'playwright-core'
import { launchApp, type AppSession } from './driver'

/**
 * 정기 실행 (docs/sdlc/scheduled-runs/ spec §7).
 *
 * 확인 간격을 한 시간으로 늘려(`ONE_DESK_SCHEDULE_TICK_MS`, spec FR-13 개정) **부팅 때의 한 번만** 돌게 한다 — 놓친 실행을 결정적으로
 * 본다. 회차는 기다리지 않고 main의 SQL로 anchor를 이틀 전으로 돌린 뒤 같은 데이터 폴더로 다시 켠다. 주기는 `매일`이다 — `평일`이면
 * 주말을 낀 이틀에 회차가 없을 수 있다.
 */

const TICK_ENV = { ONE_DESK_SCHEDULE_TICK_MS: '3600000' }
const DAY = 24 * 60 * 60_000

/** 앱의 main 프로세스에서 SQL 하나를 돌린다 — home.e2e.ts의 것과 같다(e2e 프로세스의 better-sqlite3는 Electron ABI다) */
async function runSql(app: AppSession, sql: string, params: unknown[]): Promise<void> {
  const modulePath = createRequire(import.meta.url).resolve('better-sqlite3')
  await app.electron.evaluate((_electron, input) => {
    type Req = (id: string) => unknown
    const req = (process as unknown as { mainModule?: { require: Req } }).mainModule?.require
      ?? (globalThis as unknown as { require: Req }).require
    const Database = req(input.modulePath) as new (file: string) => {
      prepare(sql: string): { run(...params: unknown[]): unknown }
      close(): void
    }
    const db = new Database(input.file)
    try {
      db.prepare(input.sql).run(...input.params)
    } finally {
      db.close()
    }
  }, { file: join(app.dataDir, 'one-desk.db'), sql, params, modulePath })
}

async function setup(page: Page, repoDir: string): Promise<void> {
  await page.getByPlaceholder('새 workspace 이름…').fill('e2e-ws')
  await page.getByPlaceholder('새 workspace 이름…').press('Enter')
  await page.getByRole('button', { name: 'e2e-ws', exact: true }).click()
  await page.getByRole('button', { name: 'repo 등록' }).click()
  await page.getByPlaceholder('repo 이름').fill('api')
  await page.getByPlaceholder('/절대/경로').fill(repoDir)
  await page.getByRole('button', { name: '추가' }).click()
  await page.getByRole('button', { name: 'api 맥락에 담기' }).waitFor({ state: 'visible', timeout: 10_000 })
  await page.getByPlaceholder('새 이슈 (첫 줄이 제목)').fill('환불 웹훅')
  await page.getByPlaceholder('새 이슈 (첫 줄이 제목)').press('Enter')
  await page.getByRole('button', { name: '환불 웹훅', exact: true }).waitFor({ state: 'visible', timeout: 10_000 })
}

async function openSchedules(page: Page): Promise<void> {
  await page.getByRole('button', { name: '정기 실행', exact: true }).click()
  await page.getByRole('region', { name: '정기 실행' }).waitFor({ state: 'visible', timeout: 10_000 })
}

async function fillNew(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: '새 정기 실행' }).click()
  await page.getByLabel('정기 실행 이름').fill(name)
  await page.getByLabel('정기 실행 지시').fill('열린 이슈를 요약해 줘')
  await page.getByRole('radio', { name: '매일' }).check()
  await page.getByLabel('정기 실행 시각').fill('09:00')
}

describe('정기 실행 (docs/sdlc/scheduled-runs/)', () => {
  it('만들고 지금 실행하고 대화를 열고, 앱을 끈 동안 놓친 회차는 켤 때 한 번 돈다', async () => {
    const app = await launchApp({ env: TICK_ENV })
    const { page } = app
    await setup(page, app.repoDir)
    await openSchedules(page)

    await fillNew(page, '아침 훑기')
    await page.getByRole('checkbox', { name: /환불 웹훅/ }).check()
    // 미리보기는 core가 계산한 세 시각이다 (FR-9)
    const preview = page.locator('.schedule-preview')
    await expect.poll(() => preview.textContent(), { timeout: 10_000 }).toMatch(/^다음: .+ · .+ · .+$/)
    await page.getByRole('form', { name: '정기 실행 편집' }).getByRole('button', { name: '저장', exact: true }).click()

    const row = page.getByRole('button', { name: '아침 훑기 정기 실행 편집' })
    await row.waitFor({ state: 'visible', timeout: 10_000 })
    expect(await row.textContent()).toContain('api · 매일 09:00')

    // 지금 실행 → 기록 한 줄 → 끝나면 완료
    await page.getByRole('button', { name: '지금 실행' }).click()
    const fires = page.getByRole('region', { name: '실행 기록' })
    await fires.locator('.schedule-fire').first().waitFor({ state: 'visible', timeout: 10_000 })
    await expect.poll(() => fires.locator('.schedule-fire').count(), { timeout: 10_000 }).toBe(1)
    expect(await fires.locator('.schedule-fire-cause').first().textContent()).toBe('지금 실행')
    await fires.locator('.status-succeeded').first().waitFor({ state: 'visible', timeout: 20_000 })

    // 대화 열기 → 도크에 그 대화, 제목은 `<이름> · M/D HH:mm`
    await fires.getByRole('button', { name: '대화 열기' }).first().click()
    await page.getByRole('region', { name: '정기 실행' }).waitFor({ state: 'detached', timeout: 10_000 })
    const title = page.locator('.dock-conv-title', { hasText: '아침 훑기 ·' })
    await title.first().waitFor({ state: 'visible', timeout: 10_000 })
    expect(await title.first().textContent()).toMatch(/^아침 훑기 · \d+\/\d+ \d\d:\d\d$/)

    // 앱을 끈 동안 이틀이 지난 것처럼 — 같은 데이터 폴더로 다시 켜면 부팅 tick이 한 번만 돈다 (FR-11·14)
    await runSql(app, 'UPDATE schedule SET anchor_at = ? WHERE name = ?', [Date.now() - 2 * DAY, '아침 훑기'])
    await app.relaunch()
    await openSchedules(app.page)
    await app.page.getByRole('button', { name: '아침 훑기 정기 실행 편집' }).click()
    const after = app.page.getByRole('region', { name: '실행 기록' })
    await expect.poll(() => after.locator('.schedule-fire').count(), { timeout: 15_000 }).toBe(2)
    expect(await after.locator('.schedule-fire-cause').allTextContents()).toEqual(['놓쳐서 실행', '지금 실행'])
    await app.close()
  }, 120_000)

  it('전체 허용으로 올릴 때는 두 번 눌러야 저장된다 (FR-29)', async () => {
    const app = await launchApp({ env: TICK_ENV })
    const { page } = app
    await setup(page, app.repoDir)
    await openSchedules(page)

    await fillNew(page, '위험한 정리')
    await page.getByLabel('정기 실행 권한').selectOption('full')
    await page.getByText(/사람이 보지 않는 시각에/).waitFor({ state: 'visible', timeout: 5_000 })
    const form = page.getByRole('form', { name: '정기 실행 편집' })
    await expect.poll(() => form.getByRole('button', { name: '저장', exact: true }).isEnabled(), { timeout: 10_000 }).toBe(true)
    await form.getByRole('button', { name: '저장', exact: true }).click()
    // 첫 누름은 무장만 한다 — 목록에 아직 없다
    await form.getByRole('button', { name: /전체 허용으로 저장합니다/ }).waitFor({ state: 'visible', timeout: 5_000 })
    expect(await page.getByRole('button', { name: '위험한 정리 정기 실행 편집' }).count()).toBe(0)
    await form.getByRole('button', { name: /전체 허용으로 저장합니다/ }).click()
    await page.getByRole('button', { name: '위험한 정리 정기 실행 편집' }).waitFor({ state: 'visible', timeout: 10_000 })
    await app.close()
  }, 90_000)
})
