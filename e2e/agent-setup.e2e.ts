import { describe, it, expect, onTestFinished } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { launchApp } from './driver'

/**
 * agent 준비 상태와 실행 조건의 IPC 왕복 (docs/sdlc/agent-setup/).
 *
 * 단위 테스트는 가짜 client와 가짜 spec으로 도므로, 채널 이름·preload 한 줄·핸들러가
 * 어긋나도 전부 초록이다. 그리고 **어댑터가 조립한 인자가 실제로 CLI까지 닿는지**는
 * `buildCommand`의 반환값만 보는 단위 테스트로는 영영 알 수 없다 — manager나
 * execution이 중간에서 값을 떨어뜨려도 각 계층이 자기 몫만 맞으면 다 통과한다.
 */
describe('agent 준비 상태', () => {
  it('설정 화면이 CLI 상태를 보여준다', async () => {
    const app = await launchApp()
    const { page } = app

    await page.getByPlaceholder('새 workspace 이름…').fill('e2e-agent')
    await page.getByPlaceholder('새 workspace 이름…').press('Enter')
    const ws = page.getByRole('button', { name: /^e2e-agent$/ })
    await ws.waitFor({ state: 'visible', timeout: 10_000 })
    await ws.click()

    await page.getByRole('button', { name: '설정' }).click()

    const status = page.getByLabel('CLI 상태')
    await status.waitFor({ state: 'visible', timeout: 10_000 })
    // 빠른 칸(실행 파일)은 probeAgents를 기다리지 않는다 — 이 단언이 성립하려면
    // 두 조회가 따로 돌아야 한다(FR-7).
    // vitest의 expect에는 Playwright의 toContainText가 없다(playwright-core만 쓰고
    // @playwright/test는 의존성에 없다) — expect.poll로 같은 재시도 의미를 살린다.
    await expect.poll(() => status.textContent(), { timeout: 10_000 }).toContain('Claude Code')
    expect(await status.textContent()).toContain('OpenCode')

    // 느린 칸이 실제로 왔다는 증거. 가짜 CLI에는 `auth status`가 없으므로
    // **"인증 확인 불가"**가 와야 한다 — "로그인 필요"가 오면 조회 실패를
    // 로그인 안 됨으로 단정한 것이고, 그것이 FR-3이 막으려던 거짓말이다.
    await expect.poll(
      () => status.textContent(),
      { timeout: 20_000 }
    ).toContain('인증 확인 불가')
    expect(await status.textContent()).not.toContain('로그인 필요')

    // 버튼이 살아 있다 — 캐시를 버리고 다시 조회한다.
    await page.getByRole('button', { name: '다시 확인' }).click()
    await status.waitFor({ state: 'visible', timeout: 10_000 })
  })

  it('제안에 없는 모델 이름도 저장돼 실행 패널에 그대로 온다', async () => {
    // **자유 입력을 남긴 것이 이 기능의 핵심이다.** 드롭다운으로 강제했다면
    // 앱이 든 별칭 표가 낡은 날 새 모델을 아예 못 쓰게 된다(FR-8).
    const app = await launchApp()
    const { page } = app

    await page.getByPlaceholder('새 workspace 이름…').fill('e2e-model')
    await page.getByPlaceholder('새 workspace 이름…').press('Enter')
    const ws = page.getByRole('button', { name: /^e2e-model$/ })
    await ws.waitFor({ state: 'visible', timeout: 10_000 })
    await ws.click()

    await page.getByRole('button', { name: '설정' }).click()
    const claudeModel = page.getByLabel('Claude Code 기본 모델')
    await claudeModel.waitFor({ state: 'visible', timeout: 10_000 })
    // 어느 표에도 없는 이름이다.
    await claudeModel.fill('claude-made-up-9')
    await page.getByRole('button', { name: '기본값 저장', exact: true }).click()

    await ws.click()
    const runModel = page.getByLabel('모델', { exact: true })
    await runModel.waitFor({ state: 'visible', timeout: 10_000 })
    await expect.poll(() => runModel.inputValue(), { timeout: 10_000 }).toBe('claude-made-up-9')
  })
})

describe('effort', () => {
  it('고른 effort가 실제로 CLI 인자까지 간다', async () => {
    const captureDir = mkdtempSync(join(tmpdir(), 'one-desk-effort-'))
    onTestFinished(() => rmSync(captureDir, { recursive: true, force: true }))
    const capture = join(captureDir, 'args.json')
    const app = await launchApp({ env: { ONE_DESK_ARGS_CAPTURE: capture } })
    const { page } = app

    await page.getByPlaceholder('새 workspace 이름…').fill('e2e-effort')
    await page.getByPlaceholder('새 workspace 이름…').press('Enter')
    const ws = page.getByRole('button', { name: /^e2e-effort$/ })
    await ws.waitFor({ state: 'visible', timeout: 10_000 })
    await ws.click()

    await page.getByRole('button', { name: 'repo 등록' }).click()
    await page.getByPlaceholder('repo 이름').fill('effort-repo')
    await page.getByPlaceholder('/절대/경로').fill(app.repoDir)
    await page.getByRole('button', { name: '추가', exact: true }).click()
    await page.getByRole('button', { name: 'effort-repo 맥락에 담기' })
      .waitFor({ state: 'visible', timeout: 10_000 })

    // 실행 패널에서 그 run에만 적용되는 값으로 고른다.
    await page.getByLabel('effort', { exact: true }).selectOption('xhigh')
    await page.getByPlaceholder(/무엇을 시킬지/).fill('아무거나')
    await page.getByRole('button', { name: '실행', exact: true }).click()

    await page.getByRole('button', { name: /succeeded|failed/ })
      .waitFor({ timeout: 30_000 })

    const args = JSON.parse(readFileSync(capture, 'utf8')) as string[]
    const i = args.indexOf('--effort')
    expect(i).toBeGreaterThanOrEqual(0)
    expect(args[i + 1]).toBe('xhigh')
  })

  it('effort를 비우면 --effort가 아예 붙지 않는다', async () => {
    // 빈 값은 "CLI 자신의 기본값"이다 — `--effort ''`를 붙이면 그 뜻이 깨진다.
    const captureDir = mkdtempSync(join(tmpdir(), 'one-desk-effort-none-'))
    onTestFinished(() => rmSync(captureDir, { recursive: true, force: true }))
    const capture = join(captureDir, 'args.json')
    const app = await launchApp({ env: { ONE_DESK_ARGS_CAPTURE: capture } })
    const { page } = app

    await page.getByPlaceholder('새 workspace 이름…').fill('e2e-effort-none')
    await page.getByPlaceholder('새 workspace 이름…').press('Enter')
    const ws = page.getByRole('button', { name: /^e2e-effort-none$/ })
    await ws.waitFor({ state: 'visible', timeout: 10_000 })
    await ws.click()

    await page.getByRole('button', { name: 'repo 등록' }).click()
    await page.getByPlaceholder('repo 이름').fill('none-repo')
    await page.getByPlaceholder('/절대/경로').fill(app.repoDir)
    await page.getByRole('button', { name: '추가', exact: true }).click()
    await page.getByRole('button', { name: 'none-repo 맥락에 담기' })
      .waitFor({ state: 'visible', timeout: 10_000 })

    await page.getByPlaceholder(/무엇을 시킬지/).fill('아무거나')
    await page.getByRole('button', { name: '실행', exact: true }).click()
    await page.getByRole('button', { name: /succeeded|failed/ })
      .waitFor({ timeout: 30_000 })

    const args = JSON.parse(readFileSync(capture, 'utf8')) as string[]
    expect(args).not.toContain('--effort')
  })
})
