import { describe, it, expect } from 'vitest'
import { launchApp } from './driver'

// 실제 OpenCode CLI로 한 턴을 끝까지 돌린다. 합성 지시만 쓰고 도구 호출은 시키지 않는다.
//
//   ONE_DESK_REAL_CLI=1 ONE_DESK_REAL_AGENT_PATH=<opencode 실행 파일> \n//     npx vitest run --config vitest.e2e.config.ts e2e/opencode-real.e2e.ts
//
// 무료 모델(opencode/big-pickle)을 쓰므로 자격 증명 없이 돌릴 수 있다 — 단 권한은
// 전체 허용이어야 한다(아래 주석).
describe.skipIf(process.env['ONE_DESK_REAL_CLI'] !== '1')('실제 OpenCode 실행', () => {
  it('OpenCode 어댑터로 한 턴을 돌려 결과를 기록한다', async () => {
    const agentPath = process.env['ONE_DESK_REAL_AGENT_PATH']
    if (!agentPath) throw new Error('ONE_DESK_REAL_AGENT_PATH에 실제 opencode 실행 파일 경로를 지정하세요')
    const app = await launchApp({ agentPath })
    const { page } = app

    await page.getByPlaceholder('새 workspace 이름…').fill('OpenCode 검증')
    await page.getByPlaceholder('새 workspace 이름…').press('Enter')
    await page.getByRole('button', { name: 'OpenCode 검증', exact: true }).click()
    await page.getByPlaceholder('repo 이름').fill('합성 테스트')
    await page.getByPlaceholder('/절대/경로').fill(app.repoDir)
    await page.getByRole('button', { name: '추가', exact: true }).click()

    // getByLabel('agent')는 'Skills / Agents' 패널까지 걸려 strict mode 위반이다.
    await page.locator('.run-settings select').first().selectOption('opencode')
    await page.locator('.run-settings input').fill('opencode/big-pickle')
    // 전체 허용이어야 한다 — opencode 무료 티어(opencode/big-pickle)는 OPENCODE_PERMISSION에
    // deny가 하나라도 있으면 403 FreeTierError로 거부한다(실측). read_only/edit로 바꾸면
    // 자격 증명 없이는 통과하지 못한다.
    await page.getByLabel('권한').selectOption('full')

    const prompt = page.getByRole('textbox', { name: '지시', exact: true })
    await prompt.fill('Reply with exactly OPENCODE_E2E_5F31C9. Do not call any tools.')
    await page.getByRole('button', { name: '실행', exact: true }).click()

    await expect
      .poll(
        async () =>
          (await page.locator('.turn-answer').allTextContents()).some((text) =>
            text.includes('OPENCODE_E2E_5F31C9')
          ),
        { timeout: 120_000 }
      )
      .toBe(true)
    await page.getByRole('button', { name: /succeeded/ }).waitFor({ timeout: 120_000 })
  }, 300_000)
})
