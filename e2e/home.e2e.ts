import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { Page } from 'playwright-core'
import { launchApp, type AppSession } from './driver'
import { waitConvStatus } from './dock'

/**
 * 홈 (docs/sdlc/home/ spec §7).
 *
 * 첫 화면은 홈이고(FR-17), 준비 단계 넷이 끝나기 전에는 준비 단계다(FR-14). 가짜 CLI는 기본으로 `auth status`에 init을 찍어
 * "인증 확인 불가"이므로(agent-setup.e2e가 그것에 기댄다) 홈이 끝난 상태를 보려면 `ONE_DESK_FAKE_AUTH=ok`를 켠다.
 * 답변 필요·실패 대화는 `ONE_DESK_FAKE_SCRIPT=home`이 지시문으로 가른다(plan 개정 6). 오래 안 본 이슈는 UI로 만들 수
 * 없으므로(`markSeen`은 지금 시각) 앱의 main 프로세스에서 DB를 직접 고치고 홈을 떠났다 돌아온다.
 */

const HOME_ENV = { ONE_DESK_FAKE_AUTH: 'ok', ONE_DESK_FAKE_SCRIPT: 'home' }

async function createWorkspace(page: Page, name: string): Promise<void> {
  await page.getByPlaceholder('새 workspace 이름…').fill(name)
  await page.getByPlaceholder('새 workspace 이름…').press('Enter')
  const ws = page.getByRole('button', { name, exact: true })
  await ws.waitFor({ state: 'visible', timeout: 10_000 })
  await ws.click()
}

async function registerRepo(page: Page, name: string, path: string): Promise<void> {
  await page.getByRole('button', { name: 'repo 등록' }).click()
  await page.getByPlaceholder('repo 이름').fill(name)
  await page.getByPlaceholder('/절대/경로').fill(path)
  await page.getByRole('button', { name: '추가' }).click()
  await page.getByRole('button', { name: `${name} 맥락에 담기` }).waitFor({ state: 'visible', timeout: 10_000 })
}

/** 도크의 새 대화 칸에 지시를 보내고 그 줄의 상태를 기다린다 — 제목은 담은 것이 없어 지시의 첫 줄이다 */
async function send(page: Page, prompt: string, status: 'succeeded' | 'failed'): Promise<void> {
  await page.getByPlaceholder(/무엇을 시킬지/).fill(prompt)
  await page.getByRole('button', { name: '실행', exact: true }).click()
  await waitConvStatus(page, prompt, status)
}

async function createIssue(page: Page, title: string): Promise<void> {
  await page.getByPlaceholder('새 이슈 (첫 줄이 제목)').fill(title)
  await page.getByPlaceholder('새 이슈 (첫 줄이 제목)').press('Enter')
  await page.getByRole('button', { name: title, exact: true }).waitFor({ state: 'visible', timeout: 10_000 })
}

/** 사이드바의 홈 — 이름 /^홈/은 '홈-회사' 같은 workspace 버튼까지 잡으므로 클래스로 좁힌다 */
async function goHome(page: Page): Promise<void> {
  await page.locator('button.home-link').click()
  await page.getByRole('region', { name: '홈' }).waitFor({ state: 'visible', timeout: 10_000 })
}

/** 앱의 main 프로세스에서 SQL 하나를 돌린다 — e2e 프로세스의 better-sqlite3는 Electron ABI로 빌드돼 있어 여기서 못 연다 */
async function runSql(app: AppSession, sql: string, params: unknown[]): Promise<void> {
  // 모듈은 **절대 경로**로 넘긴다 — main의 evaluate 컨텍스트에서 이름으로 찾으면 node_modules를 못 본다(실측: Cannot find module).
  // 같은 파일이고 사전 빌드는 N-API라 e2e 프로세스가 푼 경로를 Electron이 그대로 연다.
  const modulePath = createRequire(import.meta.url).resolve('better-sqlite3')
  await app.electron.evaluate((_electron, input) => {
    // 이 함수는 직렬화돼 main에서 돌므로 바깥 변수를 닫아 잡을 수 없다.
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

describe('홈 (docs/sdlc/home/)', () => {
  it('아무것도 없으면 준비 단계이고, 단계마다 사이드바의 그 폼으로 보내며, 끝난 단계는 접힌다', async () => {
    const app = await launchApp({ env: HOME_ENV })
    const page = app.page

    // 첫 화면 — 홈의 준비 단계 (FR-14·FR-17)
    await page.getByRole('heading', { name: '시작하기' }).waitFor({ state: 'visible', timeout: 10_000 })
    expect(await page.title()).toBe('홈 — one-desk')

    // ① 사이드바의 workspace 입력칸으로 (FR-16)
    await page.getByRole('button', { name: '워크스페이스 만들기' }).click()
    await expect.poll(() => page.evaluate('document.activeElement?.getAttribute("placeholder")')).toBe('새 workspace 이름…')
    await page.keyboard.type('홈-첫')
    await page.keyboard.press('Enter')
    // 홈에 남은 채로 ①이 접힌다 — 이름이 그 줄에 선다
    await page.locator('.home-step-done').filter({ hasText: '홈-첫' }).waitFor({ state: 'visible', timeout: 10_000 })

    // ② 사이드바의 repo 등록 폼을 펼쳐 포커스 — 폼을 둘 두지 않는다
    await page.getByRole('button', { name: '폴더 연결하기' }).click()
    await expect.poll(() => page.evaluate('document.activeElement?.getAttribute("placeholder")')).toBe('repo 이름')
    await page.keyboard.type('샘플')
    await page.getByPlaceholder('/절대/경로').fill(app.repoDir)
    await page.getByRole('button', { name: '추가' }).click()
    await page.locator('.home-step-done').filter({ hasText: 'repo 1개' }).waitFor({ state: 'visible', timeout: 10_000 })

    // ③ CLI — 설정 화면과 같은 줄(AgentStatusRow). 가짜 CLI가 로그인된 것으로 답하므로 초록이 된다
    await page.locator('.home-step-done').filter({ hasText: 'CLI 확인' }).waitFor({ state: 'visible', timeout: 20_000 })

    // ④ 첫 대화 — 그 workspace 화면의 새 대화 칸으로
    await page.getByRole('button', { name: /^첫 대화 보내기/ }).click()
    await send(page, '첫 지시', 'succeeded')

    // 넷이 끝나면 홈은 본문이다 (FR-14)
    await goHome(page)
    await page.getByRole('heading', { name: '오늘 할 일' }).waitFor({ state: 'visible', timeout: 10_000 })
    expect(await page.getByRole('heading', { name: '시작하기' }).count()).toBe(0)
  })

  it('할 일 넷이 workspace를 넘어 한 목록이고, 줄의 버튼이 그 자리로 데려가며, 새 대화 카드가 보낸 곳을 기억한다', async () => {
    const app = await launchApp({ env: HOME_ENV })
    const page = app.page
    const repoB = join(app.repoDir, 'b')
    mkdirSync(repoB, { recursive: true })

    // workspace 둘 — A: 답변 필요 대화 + 정리 안 된 이슈, B: 실패 대화 + 오래 안 본 이슈
    await createWorkspace(page, '홈-회사')
    await registerRepo(page, 'api', app.repoDir)
    await send(page, '[질문] 어느 브랜치?', 'succeeded')
    await createIssue(page, '정리할 이슈')

    await createWorkspace(page, '홈-개인')
    await registerRepo(page, 'web', repoB)
    await send(page, '[실패] 일부러', 'failed')
    await createIssue(page, '오래된 이슈')
    // 오래 안 본 이슈 — seen_at을 15일 전으로, 정리는 된 것으로(정리 안 됨 줄에 겹치지 않게). 앱은 바뀜 알림을 못 받는다 — 홈을 다시 열면 다시 읽는다
    const fifteenDaysAgo = Date.now() - 15 * 24 * 60 * 60 * 1000
    await runSql(app, 'UPDATE issue SET seen_at = ?, triaged_at = ? WHERE title = ?', [fifteenDaysAgo, Date.now(), '오래된 이슈'])

    // 홈 — 배지 4, 줄 넷의 순서
    await goHome(page)
    await expect.poll(async () => (await page.locator('button.home-link').textContent())?.trim(), { timeout: 10_000 }).toBe('홈4')
    const rows = page.getByRole('list', { name: '오늘 할 일' }).getByRole('listitem')
    await expect.poll(() => rows.count(), { timeout: 10_000 }).toBe(4)
    expect(await rows.nth(0).getByRole('button').allTextContents()).toEqual(['답하기'])
    expect(await rows.nth(1).getByRole('button').allTextContents()).toEqual(['다시 보내기', '대화 열기'])
    expect(await rows.nth(2).getByRole('button').allTextContents()).toEqual(['훑기'])
    expect(await rows.nth(3).getByRole('button').allTextContents()).toEqual(['방치 이슈 보기'])
    expect(await rows.nth(3).textContent()).toContain('오래된 이슈')

    // 답하기 — 그 workspace의 도크가 그 대화로 열리고 입력칸에 포커스 (FR-9)
    await rows.nth(0).getByRole('button', { name: '답하기' }).click()
    await page.locator('.turn-user').filter({ hasText: '[질문] 어느 브랜치?' }).waitFor({ state: 'visible', timeout: 10_000 })
    await expect.poll(() => page.evaluate('document.activeElement?.getAttribute("aria-label")')).toBe('지시')
    expect(await page.title()).toBe('홈-회사 — one-desk')

    // 훑기 — 이슈 패널이 훑기 카드를 띄운 채로 (FR-9)
    await goHome(page)
    await page.getByRole('list', { name: '오늘 할 일' }).getByRole('button', { name: '훑기' }).click()
    await page.locator('.triage-card').waitFor({ state: 'visible', timeout: 10_000 })
    expect(await page.locator('.triage-title').textContent()).toBe('정리할 이슈')

    // 새 대화 카드 — 보내면 그 workspace 도크에 턴이 서고, 다시 홈에 오면 대상이 그 repo다 (FR-7·FR-11)
    await goHome(page)
    await page.getByRole('combobox', { name: '대상' }).selectOption({ label: '홈-회사 · api' })
    await page.getByRole('textbox', { name: '새 대화 지시' }).fill('홈에서 보낸 지시')
    await page.getByRole('button', { name: '실행', exact: true }).click()
    await waitConvStatus(page, '홈에서 보낸 지시', 'succeeded')
    expect(await page.title()).toBe('홈-회사 — one-desk')
    await goHome(page)
    await expect.poll(
      () => page.locator('select[aria-label="대상"] option:checked').textContent(), { timeout: 10_000 }
    ).toBe('홈-회사 · api')

    // 바깥 스크롤이 없다 — 홈이 넘쳐도 스크롤은 `.home` 안에서만 한다. ModelField compact의 `.sr-only` 글자가 문서 기준
    // absolute라 `.home` 밖(문서)에 스크롤을 만들었고, 그것을 내리면 100vh 아래의 빈 body가 하얗게 보였다(2026-10-22 보고).
    await app.electron.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.setSize(1100, 520) })
    await expect.poll(() => page.evaluate('innerHeight'), { timeout: 10_000 }).toBeLessThan(600)
    // e2e의 tsconfig에는 dom lib가 없어 다른 테스트처럼 문자열로 평가한다
    const scroll = await page.evaluate<{ doc: number, win: number, homeOverflows: boolean }>(
      '(() => { const home = document.querySelector(".home"); return { doc: document.documentElement.scrollHeight, win: innerHeight, homeOverflows: home.scrollHeight > home.clientHeight } })()'
    )
    expect(scroll.homeOverflows).toBe(true)
    expect(scroll.doc).toBe(scroll.win)
  })
})
