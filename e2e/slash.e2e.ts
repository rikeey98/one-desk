import { describe, it, expect, onTestFinished } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { launchApp } from './driver'

describe('슬래시 커맨드', () => {
  it('피커에서 삽입한 커맨드가 맥락보다 앞서 실제 CLI stdin으로 전달된다', async () => {
    const captureDir = mkdtempSync(join(tmpdir(), 'one-desk-slash-'))
    onTestFinished(() => rmSync(captureDir, { recursive: true, force: true }))
    const capture = join(captureDir, 'stdin.txt')
    const app = await launchApp({ env: { ONE_DESK_PROMPT_CAPTURE: capture } })
    const { page } = app
    const commandDir = join(app.repoDir, '.claude', 'commands')
    mkdirSync(commandDir, { recursive: true })
    const commandFile = join(commandDir, 'pinetest.md')
    writeFileSync(commandFile, '---\ndescription: 솔잎 검사\n---\n$ARGUMENTS')

    await page.getByPlaceholder('새 workspace 이름…').fill('slash-ws')
    await page.getByPlaceholder('새 workspace 이름…').press('Enter')
    await page.getByRole('button', { name: 'slash-ws', exact: true }).click()
    await page.getByRole('button', { name: 'repo 등록' }).click()
    await page.getByPlaceholder('repo 이름').fill('slash-repo')
    await page.getByPlaceholder('/절대/경로').fill(app.repoDir)
    await page.getByRole('button', { name: '추가', exact: true }).click()

    await page.getByPlaceholder('새 이슈 제목…').fill('검증용 이슈')
    await page.getByPlaceholder('새 이슈 제목…').press('Enter')
    await page.getByRole('button', { name: '검증용 이슈 맥락에 담기', exact: true }).click()
    const prompt = page.getByRole('textbox', { name: '지시', exact: true })
    await prompt.fill('/')
    await page.getByRole('option', { name: '/pinetest 솔잎 검사', exact: true }).waitFor()
    expect(await page.getByRole('option', { name: /doctor|reload-plugins|color/ }).count()).toBe(0)

    writeFileSync(commandFile, '---\ndescription: 새 설명\n---\n$ARGUMENTS')
    await page.getByRole('button', { name: '커맨드 새로고침', exact: true }).click()
    await page.getByRole('option', { name: '/pinetest 새 설명', exact: true }).waitFor()
    await prompt.fill('  /pine')
    await prompt.press('Enter')
    await expect.poll(() => prompt.inputValue()).toBe('  /pinetest ')
    await page.getByText('이 커맨드는 뒤에 오는 글을 인자로 씁니다 — 담은 맥락이 인자로 전달됩니다').waitFor()
    expect(await page.getByRole('button', { name: /running|succeeded/ }).count()).toBe(0)

    const artifacts = resolve('e2e/artifacts')
    mkdirSync(artifacts, { recursive: true })
    await page.screenshot({ path: join(artifacts, 'slash-inserted.png') })
    await page.getByRole('button', { name: '실행', exact: true }).click()
    await page.getByRole('button', { name: /succeeded/ }).waitFor({ timeout: 30_000 })
    const received = readFileSync(capture, 'utf8')
    expect(received.startsWith('/pinetest ')).toBe(true)
    expect(received.indexOf('<context>')).toBeGreaterThan(0)
    expect(received).toContain('검증용 이슈')
    expect(received).toContain('[NEEDS_ANSWER]')
  })
})
