import { describe, it, expect } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Page } from 'playwright-core'
import { launchApp, type AppSession } from './driver'
import { convRow, waitConvStatus } from './dock'

/**
 * 대화의 이슈화 (`docs/sdlc/agent-proposals/` spec §7) — agent가 `propose_issue`로 제안하고(가짜 MCP CLI가 브리지를 거쳐 진짜로
 * 부른다) 사람이 배너에서 받는다. 받기는 `client.proposals.accept` → preload → `ipcMain.handle` → core를 실제로 탄다.
 */
const FAKE_MCP = resolve(process.cwd(), 'core/runner/fixtures/fake-claude-mcp.mjs')
const ARTIFACTS = resolve('e2e/artifacts')
const BANNER = { name: '이 대화를 이슈로 만들까요?' }
const GUIDE_MARK = 'propose_issue 도구로'

function propose(args: Record<string, unknown>, existing = false): string {
  return JSON.stringify({ name: 'propose_issue', arguments: args, ...(existing ? { existing: 'first' } : {}) })
}

async function setup(app: AppSession, ws: string): Promise<void> {
  const page = app.page
  await page.getByPlaceholder('새 workspace 이름…').fill(ws)
  await page.getByPlaceholder('새 workspace 이름…').press('Enter')
  const wsButton = page.getByRole('button', { name: ws, exact: true })
  await wsButton.waitFor({ state: 'visible', timeout: 10_000 })
  await wsButton.click()
  await page.getByRole('button', { name: 'repo 등록' }).click()
  await page.getByPlaceholder('repo 이름').fill('web')
  await page.getByPlaceholder('/절대/경로').fill(app.repoDir)
  await page.getByRole('button', { name: '추가' }).click()
  await page.getByRole('button', { name: 'web 맥락에 담기' }).waitFor({ state: 'visible', timeout: 10_000 })
}

/** 읽기 전용으로 새 대화를 보내고 그 턴이 끝나기를 기다린다 */
async function sendReadOnly(page: Page, text: string, status: 'succeeded' | 'failed' = 'succeeded'): Promise<void> {
  await page.getByLabel('권한').selectOption('read_only')
  await page.getByRole('textbox', { name: '지시' }).fill(text)
  await page.getByRole('button', { name: '실행', exact: true }).click()
  await page.locator('.turn-user').filter({ hasText: text }).waitFor({ state: 'visible', timeout: 10_000 })
  await waitConvStatus(page, null, status, 30_000)
}

async function capture(page: Page, name: string): Promise<void> {
  mkdirSync(ARTIFACTS, { recursive: true })
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    // 버튼의 background transition(.12s)이 끝난 뒤에 찍는다 — 바로 찍으면 다크에서 버튼이 흰 채로 찍힌다
    await page.waitForTimeout(400)
    await page.screenshot({ path: join(ARTIFACTS, `proposal-${name}-${scheme}.png`) })
  }
  await page.emulateMedia({ colorScheme: 'light' })
}

describe('대화의 이슈화', () => {
  it('제목을 고쳐 받으면 그 이름의 이슈가 생기고 대화에 할당된다', async () => {
    const app = await launchApp({
      agentPath: FAKE_MCP,
      env: { ONE_DESK_FAKE_MCP_CALL: propose({ title: '모바일 로그인 버튼이 눌리지 않음', body: 'Safari에서 오버레이가 탭을 가로챈다.', kind: 'bug' }) }
    })
    const page = app.page
    await setup(app, 'e2e-proposal')
    await sendReadOnly(page, '로그인 버튼이 모바일에서 안 눌려, 고쳐줘')

    const banner = page.getByRole('status', BANNER)
    await banner.waitFor({ state: 'visible', timeout: 10_000 })
    const title = banner.getByRole('textbox', { name: '제안된 이슈 제목' })
    expect(await title.inputValue()).toBe('모바일 로그인 버튼이 눌리지 않음')
    await capture(page, 'new')

    await title.fill('모바일 Safari 로그인 버튼 고치기')
    await banner.getByRole('button', { name: '이슈로 만들기', exact: true }).click()
    await banner.waitFor({ state: 'detached', timeout: 10_000 })

    // 이슈 패널에 고친 제목 · 헤더에 이슈 링크 · 도크 줄 제목이 이슈 이름
    await page.getByRole('button', { name: '모바일 Safari 로그인 버튼 고치기', exact: true })
      .waitFor({ state: 'visible', timeout: 10_000 })
    await page.getByRole('button', { name: '할당된 이슈 열기' }).waitFor({ state: 'visible', timeout: 10_000 })
    await convRow(page, '모바일 Safari 로그인 버튼 고치기').waitFor({ state: 'visible', timeout: 10_000 })
    await capture(page, 'accepted')

    // 이슈 상세에서 그 대화로 돌아간다
    await page.getByRole('button', { name: '새 대화', exact: true }).click()
    await page.getByRole('button', { name: '모바일 Safari 로그인 버튼 고치기', exact: true }).click()
    await page.getByRole('button', { name: '이 이슈의 대화 열기' }).click()
    await page.locator('.turn-user').filter({ hasText: '로그인 버튼이 모바일에서 안 눌려' })
      .waitFor({ state: 'visible', timeout: 10_000 })
  })

  it('이슈로 만들지 않기는 다시 켜도 남고, 그 대화의 다음 턴에는 안내가 없다', async () => {
    const promptFile = join(mkdtempSync(join(tmpdir(), 'one-desk-e2e-prompt-')), 'prompt.txt')
    const app = await launchApp({
      agentPath: FAKE_MCP,
      env: { ONE_DESK_FAKE_MCP_CALL: propose({ title: '잡담을 이슈로' }), ONE_DESK_PROMPT_CAPTURE: promptFile }
    })
    const page = app.page
    await setup(app, 'e2e-decline')
    await sendReadOnly(page, '이 함수 뭐 하는 거야?')
    expect(readFileSync(promptFile, 'utf8')).toContain(GUIDE_MARK)

    const banner = page.getByRole('status', BANNER)
    await banner.waitFor({ state: 'visible', timeout: 10_000 })
    await banner.getByRole('button', { name: '이슈로 만들지 않기' }).click()
    await banner.waitFor({ state: 'detached', timeout: 10_000 })

    await app.relaunch()
    const again = app.page
    await again.getByRole('button', { name: 'e2e-decline', exact: true }).click()
    await convRow(again, '이 함수 뭐 하는 거야?').click()
    await again.locator('.turn-user').filter({ hasText: '이 함수 뭐 하는 거야?' }).waitFor({ state: 'visible', timeout: 10_000 })
    expect(await again.getByRole('status', BANNER).count()).toBe(0)

    // 다음 턴 — 거절한 대화라 안내가 없다. 가짜 CLI는 같은 제안을 다시 부르고 도구 오류로 끝난다(저장되지 않는다)
    await again.getByRole('textbox', { name: '지시' }).fill('그럼 이건?')
    await again.getByRole('button', { name: '실행', exact: true }).click()
    await again.locator('.turn-user').filter({ hasText: '그럼 이건?' }).waitFor({ state: 'visible', timeout: 10_000 })
    await waitConvStatus(again, null, 'failed', 30_000)
    expect(readFileSync(promptFile, 'utf8')).toContain('그럼 이건?')
    expect(readFileSync(promptFile, 'utf8')).not.toContain(GUIDE_MARK)
    expect(await again.getByRole('status', BANNER).count()).toBe(0)
  })

  it('기존 이슈에 붙이면 새 이슈가 생기지 않고 그 이슈가 할당된다', async () => {
    const app = await launchApp({
      agentPath: FAKE_MCP,
      env: { ONE_DESK_FAKE_MCP_CALL: propose({ title: '로그인 버튼 고치기' }, true) }
    })
    const page = app.page
    await setup(app, 'e2e-existing')
    await page.getByPlaceholder('새 이슈 (첫 줄이 제목)').fill('로그인 버튼 반응 없음')
    await page.getByPlaceholder('새 이슈 (첫 줄이 제목)').press('Enter')
    await page.getByRole('button', { name: '로그인 버튼 반응 없음', exact: true }).waitFor({ state: 'visible', timeout: 10_000 })

    await sendReadOnly(page, '로그인 버튼 좀 봐줘')
    const banner = page.getByRole('status', BANNER)
    await banner.waitFor({ state: 'visible', timeout: 10_000 })
    await expect.poll(() => banner.textContent()).toContain('기존 이슈 「로그인 버튼 반응 없음」에 붙일까요?')
    await capture(page, 'existing')

    await banner.getByRole('button', { name: '기존 이슈에 붙이기' }).click()
    await banner.waitFor({ state: 'detached', timeout: 10_000 })
    await page.getByRole('button', { name: '할당된 이슈 열기' }).waitFor({ state: 'visible', timeout: 10_000 })
    await convRow(page, '로그인 버튼 반응 없음').waitFor({ state: 'visible', timeout: 10_000 })
    expect(await page.getByRole('button', { name: '로그인 버튼 고치기', exact: true }).count()).toBe(0)
    expect(await page.getByRole('region', { name: '이슈', exact: true }).locator('li.item').count()).toBe(1)
  })
})
