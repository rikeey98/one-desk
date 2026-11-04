import { describe, it, expect } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import type { Page } from 'playwright-core'
import { launchApp, type AppSession } from './driver'
import { waitConvStatus } from './dock'

/**
 * 홈 대화 (`docs/sdlc/home-conversation/` spec §4) — 홈 화면 바닥의 도크에서 보낸 대화가 홈 폴더 · 읽기 전용으로 돌고, 가짜 MCP CLI가
 * 브리지를 거쳐 진짜로 부른 `list_conversations`가 **두 workspace의 대화를** 돌려준다. 그 대화는 사이드바에 없고 인박스에 `홈`으로 뜨며,
 * 인박스의 `대화 열기`가 홈 화면의 도크로 연다.
 */
const FAKE_MCP = resolve(process.cwd(), 'core/runner/fixtures/fake-claude-mcp.mjs')
const ARTIFACTS = resolve('e2e/artifacts')

interface Capture {
  cwd: string
  argv: string[]
  result: string
}

async function addWorkspace(app: AppSession, ws: string, repoName: string): Promise<void> {
  const page = app.page
  await page.getByPlaceholder('새 workspace 이름…').fill(ws)
  await page.getByPlaceholder('새 workspace 이름…').press('Enter')
  const wsButton = page.getByRole('button', { name: ws, exact: true })
  await wsButton.waitFor({ state: 'visible', timeout: 10_000 })
  await wsButton.click()
  await page.getByRole('button', { name: 'repo 등록' }).click()
  await page.getByPlaceholder('repo 이름').fill(repoName)
  await page.getByPlaceholder('/절대/경로').fill(app.repoDir)
  await page.getByRole('button', { name: '추가' }).click()
  await page.getByRole('button', { name: `${repoName} 맥락에 담기` }).waitFor({ state: 'visible', timeout: 10_000 })
}

/** 지금 보이는 도크에서 새 대화를 보내고 그 턴이 끝나기를 기다린다 */
async function send(page: Page, text: string): Promise<void> {
  await page.getByRole('textbox', { name: '지시' }).fill(text)
  await page.getByRole('button', { name: '실행', exact: true }).click()
  await page.locator('.turn-user').filter({ hasText: text }).waitFor({ state: 'visible', timeout: 10_000 })
  await waitConvStatus(page, null, 'succeeded', 30_000)
}

async function capture(page: Page, name: string): Promise<void> {
  mkdirSync(ARTIFACTS, { recursive: true })
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    await page.waitForTimeout(400)
    await page.screenshot({ path: join(ARTIFACTS, `home-conversation-${name}-${scheme}.png`) })
  }
  await page.emulateMedia({ colorScheme: 'light' })
}

describe('홈 대화', () => {
  it('홈 도크의 대화가 홈 폴더 · 읽기 전용으로 돌며 두 workspace의 대화를 읽고, 인박스에서 홈으로 돌아온다', async () => {
    const captureFile = join(mkdtempSync(join(tmpdir(), 'one-desk-home-conv-')), 'capture.json')
    const app = await launchApp({
      agentPath: FAKE_MCP,
      env: {
        ONE_DESK_FAKE_MCP_CALL: JSON.stringify({ name: 'list_conversations', arguments: {} }),
        ONE_DESK_FAKE_MCP_CAPTURE: captureFile
      }
    })
    const page = app.page
    try {
      await addWorkspace(app, 'e2e-회사', 'api')
      await page.getByLabel('권한').selectOption('read_only')
      await send(page, '회사 쪽 대화')
      await addWorkspace(app, 'e2e-개인', 'blog')
      await page.getByLabel('권한').selectOption('read_only')
      await send(page, '개인 쪽 대화')

      // 홈 — 도크는 접힌 채다
      await page.getByRole('button', { name: /^홈/ }).first().click()
      const toggle = page.getByRole('button', { name: '대화창 보이기' })
      await toggle.waitFor({ state: 'visible', timeout: 10_000 })
      await page.getByText('모든 workspace를 읽습니다').waitFor({ state: 'visible' })
      await capture(page, 'folded')
      await toggle.click()

      // 입력부는 읽기 전용에 잠기고 작업 디렉토리 알약이 없다
      expect(await page.getByLabel('권한').inputValue()).toBe('읽기 전용')
      expect(await page.getByLabel('작업 디렉토리', { exact: true }).count()).toBe(0)
      await send(page, '내가 뭐 하고 있었지')
      await capture(page, 'open')

      const got = JSON.parse(readFileSync(captureFile, 'utf8')) as Capture
      expect(basename(got.cwd)).toBe('home-conversation')
      expect(got.argv).toContain('--tools')
      expect(got.argv[got.argv.indexOf('--disallowedTools') + 1]).toContain('Edit')
      const rows = JSON.parse(got.result) as Array<{ workspaceName: string; title: string }>
      expect(rows.map((r) => r.workspaceName).sort()).toEqual(['e2e-개인', 'e2e-회사'])

      // 사이드바에는 두 workspace뿐이다
      expect(await page.locator('.ws-row').count()).toBe(2)

      // 인박스에 홈으로 뜨고, 대화 열기가 홈 화면의 도크로 연다
      await page.getByRole('button', { name: /^인박스/ }).click()
      const item = page.locator('.inbox-item').filter({ hasText: '내가 뭐 하고 있었지' })
      await item.waitFor({ state: 'visible', timeout: 10_000 })
      expect(await item.locator('.inbox-ws').innerText()).toBe('홈')
      await item.getByRole('button', { name: '대화 열기' }).click()
      await page.locator('section.home').waitFor({ state: 'visible', timeout: 10_000 })
      await page.locator('.turn-user').filter({ hasText: '내가 뭐 하고 있었지' }).waitFor({ state: 'visible', timeout: 10_000 })
    } finally {
      await app.close()
    }
  })
})
