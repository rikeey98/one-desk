import { describe, it, expect } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp } from './driver'

// 실제 CLI로 커맨드 확장을 확인한다. 별도 임시 repo의 합성 지시만 사용한다.
describe.skipIf(process.env['ONE_DESK_REAL_CLI'] !== '1')('실제 CLI 슬래시 커맨드', () => {
  it('커맨드 파일 안의 표식을 출력하고 같은 대화에서 다시 확장한다', async () => {
    const agentPath = process.env['ONE_DESK_REAL_AGENT_PATH']
    if (!agentPath) throw new Error('ONE_DESK_REAL_AGENT_PATH에 실제 claude 실행 파일 경로를 지정하세요')
    const app = await launchApp({ agentPath })
    const { page } = app
    const commandDir = join(app.repoDir, '.claude', 'commands')
    mkdirSync(commandDir, { recursive: true })
    writeFileSync(join(commandDir, 'onedesk-smoke.md'), [
      '---', 'description: one-desk 확장 검증', '---',
      'Reply with exactly SLASH_EXPANDED_73BD29. Do not call any tools or read files.'
    ].join('\n'))
    await page.getByPlaceholder('새 workspace 이름…').fill('실제 CLI 검증')
    await page.getByPlaceholder('새 workspace 이름…').press('Enter')
    await page.getByRole('button', { name: '실제 CLI 검증', exact: true }).click()
    await page.getByRole('button', { name: 'repo 등록' }).click()
    await page.getByPlaceholder('repo 이름').fill('합성 테스트')
    await page.getByPlaceholder('/절대/경로').fill(app.repoDir)
    await page.getByRole('button', { name: '추가', exact: true }).click()
    await page.getByLabel('권한').selectOption('read_only')
    const prompt = page.getByRole('textbox', { name: '지시', exact: true })
    await prompt.fill('/onedesk-smoke')
    await page.getByRole('option', { name: '/onedesk-smoke one-desk 확장 검증', exact: true }).waitFor({ timeout: 20_000 })
    await prompt.press('Enter')
    await page.getByRole('button', { name: '실행', exact: true }).click()
    await expect.poll(async () => (await page.locator('.turn-answer').allTextContents()).some((text) => text.includes('SLASH_EXPANDED_73BD29')), { timeout: 90_000 }).toBe(true)
    await page.getByRole('button', { name: /succeeded/ }).waitFor({ timeout: 90_000 })
    // 첫 대화가 마운트된 후에만 두 번째 턴을 채운다.
    await page.locator('.turn-user').first().waitFor()
    await prompt.fill('/onedesk-smoke')
    await prompt.press('Enter')
    await page.getByRole('button', { name: '실행', exact: true }).click()
    await expect.poll(async () => (await page.locator('.turn-answer').allTextContents()).filter((text) => text.includes('SLASH_EXPANDED_73BD29')).length, { timeout: 90_000 }).toBeGreaterThanOrEqual(2)
  }, 240_000)
})
