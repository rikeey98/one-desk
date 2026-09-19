import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { launchApp } from './driver'

/**
 * workspace 실행 기본값의 IPC 왕복.
 *
 * 단위 테스트는 가짜 client로 도므로 채널 이름·preload 한 줄·핸들러가 서로 어긋나도
 * 전부 초록이다. 여기서만 `client.workspaces.updateDefaults` → preload →
 * `ipcMain.handle` → 저장소가 실제로 이어져 있는지 드러난다 — 본문 편집이
 * `e2e/body.e2e.ts`를 둔 이유와 같다.
 */
describe('workspace 실행 기본값', () => {
  it('설정에서 정한 기본 모델을 실행 패널이 쓴다', async () => {
    const app = await launchApp()
    const page = app.page

    await page.getByPlaceholder('새 workspace 이름…').fill('e2e-defaults')
    await page.getByPlaceholder('새 workspace 이름…').press('Enter')
    const ws = page.getByRole('button', { name: /^e2e-defaults$/ })
    await ws.waitFor({ state: 'visible', timeout: 10_000 })
    await ws.click()

    // 지금은 비어 있다 — 비어 있으면 어댑터가 -m을 붙이지 않고 CLI 기본값으로 돈다.
    const runModel = page.getByLabel('모델', { exact: true })
    await runModel.waitFor({ state: 'visible', timeout: 10_000 })
    await expect.poll(() => runModel.inputValue(), { timeout: 5_000 }).toBe('')

    await page.getByRole('button', { name: '설정' }).click()
    const claudeModel = page.getByLabel('Claude Code 기본 모델')
    await claudeModel.waitFor({ state: 'visible', timeout: 10_000 })
    await claudeModel.fill('sonnet')
    await page.getByLabel('OpenCode 기본 모델').fill('anthropic/claude-sonnet-4-5')
    await page.getByLabel('기본 agent').selectOption('opencode')
    // exact가 없으면 같은 화면의 글로벌 경로 "저장"까지 걸려 strict mode 위반이 된다.
    await page.getByRole('button', { name: '기본값 저장', exact: true }).click()

    // 저장이 끝나면 App이 목록을 다시 읽는다. workspace로 돌아가면 새로고침 없이 보인다.
    await ws.click()
    await runModel.waitFor({ state: 'visible', timeout: 10_000 })

    // 기본 agent를 opencode로 바꿨으므로 **opencode 칸**의 값이 와야 한다.
    // 두 CLI의 모델 지정 형식이 달라 컬럼이 나뉘어 있다(전체 설계 §199) — 여기서
    // 'sonnet'이 오면 claude 별칭이 opencode로 넘어가는 것이다.
    await expect.poll(() => page.getByLabel('agent', { exact: true }).inputValue(), { timeout: 5_000 })
      .toBe('opencode')
    await expect.poll(() => runModel.inputValue(), { timeout: 5_000 })
      .toBe('anthropic/claude-sonnet-4-5')

    // agent를 되돌리면 모델 칸도 claude 쪽 기본값으로 따라온다.
    await page.getByLabel('agent', { exact: true }).selectOption('claude-code')
    await expect.poll(() => runModel.inputValue(), { timeout: 5_000 }).toBe('sonnet')
  })

  it('전체 허용으로 올리려면 한 번 더 눌러야 하고, 그 뒤 실행 패널이 그 값으로 시작한다', async () => {
    const app = await launchApp()
    const page = app.page

    await page.getByPlaceholder('새 workspace 이름…').fill('e2e-perm')
    await page.getByPlaceholder('새 workspace 이름…').press('Enter')
    const ws = page.getByRole('button', { name: /^e2e-perm$/ })
    await ws.waitFor({ state: 'visible', timeout: 10_000 })
    await ws.click()

    const runPermission = page.getByLabel('권한')
    await runPermission.waitFor({ state: 'visible', timeout: 10_000 })
    await expect.poll(() => runPermission.inputValue(), { timeout: 5_000 }).toBe('edit')

    await page.getByRole('button', { name: '설정' }).click()
    const defaultPermission = page.getByLabel('기본 권한')
    await defaultPermission.waitFor({ state: 'visible', timeout: 10_000 })
    await defaultPermission.selectOption('full')

    // 전체 설계 §403의 별도 확인 절차 — 첫 클릭은 무장만 하고 저장하지 않는다.
    await page.getByRole('button', { name: '기본값 저장', exact: true }).click()
    await page.getByRole('button', { name: /한 번 더/ }).click()

    await ws.click()
    await runPermission.waitFor({ state: 'visible', timeout: 10_000 })
    await expect.poll(() => runPermission.inputValue(), { timeout: 5_000 }).toBe('full')
  })

  it('CLI 경로를 저장하면 그 경로로 실행 파일이 잡힌 것을 그 자리에서 보여준다', async () => {
    // 설계 §595의 고리를 닫는다: 실행이 "찾을 수 없습니다"로 막히면 → 설정에서
    // 경로를 넣고 → 실제로 잡혔는지 여기서 확인한다.
    //
    // ONE_DESK_AGENT_PATH가 잡혀 있으면 workspace 설정을 이기므로(실행과 같은 규칙)
    // 이 세션은 그 변수를 비우고 띄운다 — 그러지 않으면 무엇을 넣든 가짜 CLI가 뜬다.
    const app = await launchApp({ agentPath: '' })
    const page = app.page

    await page.getByPlaceholder('새 workspace 이름…').fill('e2e-cli')
    await page.getByPlaceholder('새 workspace 이름…').press('Enter')
    const ws = page.getByRole('button', { name: /^e2e-cli$/ })
    await ws.waitFor({ state: 'visible', timeout: 10_000 })
    await ws.click()

    await page.getByRole('button', { name: '설정' }).click()
    const status = page.getByLabel('CLI 상태')
    await status.waitFor({ state: 'visible', timeout: 10_000 })

    // 실제로 존재하고 실행 가능한 파일 — 이 e2e를 돌리는 node 바이너리다.
    // 플랫폼별 실행 권한 규칙을 흉내내지 않고 진짜를 쓴다.
    await page.getByLabel('Claude Code 실행 파일').fill(process.execPath)
    await page.getByRole('button', { name: 'CLI 경로 저장', exact: true }).click()

    await expect.poll(() => status.innerText(), { timeout: 10_000 }).toContain(process.execPath)

    // 없는 경로를 넣으면 같은 자리에서 이유가 드러난다 — 실행을 막는 것과 같은 판정이다.
    await page.getByLabel('Claude Code 실행 파일').fill(join(app.dataDir, '없는-claude'))
    await page.getByRole('button', { name: 'CLI 경로 저장', exact: true }).click()

    await expect.poll(() => status.innerText(), { timeout: 10_000 }).toContain('실행할 수 없습니다')
  })
})
