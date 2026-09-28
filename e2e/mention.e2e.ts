import { describe, it, expect, onTestFinished } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { launchApp } from './driver'
import { waitConvStatus } from './dock'

/**
 * `@` 파일 참조의 한 바퀴 (docs/sdlc/input-triggers/ spec §9). 피커 → 삽입 → 실행 → 가짜 CLI가 받은 stdin →
 * 대화 헤더의 "담긴 것". IPC 배선(`files:search`)은 이 테스트만 고정한다 — 단위 테스트는 preload를 타지 않는다.
 */
describe('@ 파일 참조', () => {
  it('피커로 고른 파일이 <files>로 실리고, 지시문의 @는 CLI에 가지 않으며, 무시된 파일은 목록에 없다', async () => {
    const captureDir = mkdtempSync(join(tmpdir(), 'one-desk-mention-'))
    onTestFinished(() => rmSync(captureDir, { recursive: true, force: true }))
    const capture = join(captureDir, 'stdin.txt')
    const app = await launchApp({ env: { ONE_DESK_PROMPT_CAPTURE: capture } })
    const { page } = app

    // e2e의 repo는 git 저장소가 아니다 — 이 테스트만 만든다(테스트 프로세스의 동기 git은 앱 밖이다).
    execFileSync('git', ['init', '-q'], { cwd: app.repoDir })
    mkdirSync(join(app.repoDir, 'notes'), { recursive: true })
    writeFileSync(join(app.repoDir, 'notes', 'a.txt'), 'PELICAN-7731 문장')
    writeFileSync(join(app.repoDir, '.gitignore'), 'ignored.txt\n')
    writeFileSync(join(app.repoDir, 'ignored.txt'), 'SECRET')

    await page.getByPlaceholder('새 workspace 이름…').fill('mention-ws')
    await page.getByPlaceholder('새 workspace 이름…').press('Enter')
    await page.getByRole('button', { name: 'mention-ws', exact: true }).click()
    await page.getByRole('button', { name: 'repo 등록' }).click()
    await page.getByPlaceholder('repo 이름').fill('mention-repo')
    await page.getByPlaceholder('/절대/경로').fill(app.repoDir)
    await page.getByRole('button', { name: '추가', exact: true }).click()
    await page.getByRole('button', { name: 'mention-repo repo' }).waitFor({ timeout: 10_000 })

    const prompt = page.getByRole('textbox', { name: '지시', exact: true })

    // 무시된 파일은 피커에 없다.
    await prompt.fill('@ignored')
    // 빈 listbox는 크기가 0이라 "보인다"를 기다릴 수 없다 — 붙어 있는지와 안내 문구로 본다.
    await page.getByRole('listbox', { name: '파일 참조', exact: true }).waitFor({ state: 'attached' })
    await page.getByText('일치하는 파일이 없습니다').waitFor()
    expect(await page.getByRole('option', { name: 'ignored.txt', exact: true }).count()).toBe(0)

    await prompt.fill('@not')
    await page.getByRole('option', { name: 'notes/a.txt', exact: true }).waitFor()
    const artifacts = resolve('e2e/artifacts')
    mkdirSync(artifacts, { recursive: true })
    await page.screenshot({ path: join(artifacts, 'mention-picker.png') })
    await prompt.press('Enter')
    await expect.poll(() => prompt.inputValue()).toBe('@notes/a.txt ')

    await prompt.fill(`${await prompt.inputValue()}를 요약해`)
    await page.getByRole('button', { name: '실행', exact: true }).click()
    await waitConvStatus(page, null, 'succeeded', 30_000)

    const received = readFileSync(capture, 'utf8')
    expect(received).toContain('<file repo="mention-repo" path="notes/a.txt">PELICAN-7731 문장</file>')
    // 피커가 넣은 `@notes/a.txt ` 뒤에 이어 친 글이다 — `@`만 빠진다.
    expect(received).toContain('<task>\nnotes/a.txt 를 요약해\n</task>')
    expect(received).not.toContain('@notes/a.txt')
    expect(received).not.toContain('SECRET')

    // 대화 헤더의 "담긴 것"에 파일이 보인다.
    await page.locator('.applied-chip', { hasText: '파일 · notes/a.txt' }).waitFor({ timeout: 10_000 })
  })
})
