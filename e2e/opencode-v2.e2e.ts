import { describe, it, expect } from 'vitest'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Locator, Page } from 'playwright-core'
import { launchApp, type AppSession } from './driver'
import { waitConvStatus } from './dock'

/**
 * OpenCode 2.x 방언 (docs/sdlc/opencode-v2/ spec FR-26).
 *
 * 가짜 opencode의 2.x 모드(`ONE_DESK_FAKE_OPENCODE_VERSION`)는 진짜 2.x의 **계약**을 요구한다 — `--standalone`과
 * `--agent build`가 없는 run, `OPENCODE_CONFIG_CONTENT` 없는 run, `--standalone` 없는 조회를 exit 2로 거부하고, 1.x의
 * 옵션(`--variant`·`--dangerously-skip-permissions`)을 "모르는 옵션"으로 거부한다. 그래서 여기 턴이 성공했다는 것은
 * 버전 판정 → 방언 → 실행 직전 확인(`debug agents`) → 명령 인자까지 배선이 이어졌다는 뜻이다.
 *
 * 줄 모양은 2.0.18·2.3.2 실측 그대로다(호출 id `part.id`, 경로 `input.path`, 세부가 한 겹 안쪽).
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const FAKE_OPENCODE = resolve(HERE, '../core/runner/fixtures/fake-opencode.mjs')

async function prepare(app: AppSession, workspace: string): Promise<void> {
  const { page } = app
  await page.getByPlaceholder('새 workspace 이름…').fill(workspace)
  await page.getByPlaceholder('새 workspace 이름…').press('Enter')
  const ws = page.getByRole('button', { name: workspace, exact: true })
  await ws.waitFor({ state: 'visible', timeout: 10_000 })
  await ws.click()
  await page.getByRole('button', { name: 'repo 등록' }).click()
  await page.getByPlaceholder('repo 이름').fill('샘플')
  await page.getByPlaceholder('/절대/경로').fill(app.repoDir)
  await page.getByRole('button', { name: '추가', exact: true }).click()
  await page.getByRole('button', { name: '샘플 맥락에 담기' }).waitFor({ state: 'visible', timeout: 10_000 })
  // 입력부의 칸은 알약이고 이름은 aria-label이다 — '스킬 / 에이전트' 패널과 갈리게 exact로 잡는다.
  await page.getByLabel('agent', { exact: true }).selectOption('opencode')
}

async function send(page: Page, prompt: string): Promise<void> {
  await page.getByRole('textbox', { name: '지시' }).fill(prompt)
  await page.getByRole('button', { name: '실행', exact: true }).click()
}

function turnOf(page: Page, prompt: string): Locator {
  return page.locator('.turn').filter({ has: page.locator('.turn-user', { hasText: prompt }) })
}

/** 설정 화면 CLI 상태의 OpenCode 줄. 이름으로 잡는다 — 실행 파일 경로(fake-opencode.mjs)가 두 줄 다에 있다 */
function opencodeRow(page: Page): Locator {
  return page.getByRole('list', { name: 'CLI 상태', exact: true })
    .locator('li')
    .filter({ has: page.locator('.settings-status-name', { hasText: /^OpenCode$/ }) })
}

describe('OpenCode 2.x', () => {
  it('확인할 수 있는 2.x — 읽기 전용으로 첫 턴과 이은 턴이 돌고, 셸·읽기·편집 줄이 1.x와 같은 모양으로 선다', async () => {
    const app = await launchApp({
      agentPath: FAKE_OPENCODE,
      env: { ONE_DESK_FAKE_OPENCODE_VERSION: '2.3.2', ONE_DESK_FAKE_STEP_MS: '50' }
    })
    try {
      const { page } = app
      await prepare(app, 'oc-v2')
      await page.getByLabel('권한').selectOption('read_only')

      await send(page, '만료 경계를 고쳐줘')
      await waitConvStatus(page, null, 'succeeded', 30_000)
      const first = turnOf(page, '만료 경계를 고쳐줘')
      expect(await first.locator('.turn-answer').textContent()).toContain('가짜 OpenCode 2.x가 처리했습니다')

      await first.getByRole('button', { name: '자세히' }).click()
      // 셸과 읽기는 한 묶음이다 — 2.x의 `shell`이 `bash`와 같은 말로 불린다(표에 없으면 영어 이름으로 묶음 밖에 선다)
      await first.getByRole('button', { name: '셸, 읽기 사용됨' }).click()
      const rows = first.locator('.tl-activity .tl-tool')
      // 0이 아닌 종료 코드도 completed로 온다 — 세부가 한 겹 안쪽(metadata.metadata)에 있다
      expect(await rows.nth(0).textContent()).toBe('셸 npm test 종료 코드 3')
      expect(await rows.nth(1).textContent()).toContain('auth.ts')

      // 편집 — files[]의 patch에서 줄 번호가 붙는다
      const edit = first.locator('.tl-edit')
      const file = edit.getByRole('button', { name: /auth\.ts/ })
      expect(await file.textContent()).toContain('+1 −1')
      await file.click()
      expect((await edit.locator('.tl-diff-no').allTextContents()).slice(0, 2)).toEqual(['41', '41'])

      // 이어 가는 턴 — 실행 직전 확인이 그 세션이 있는지 묻고(가짜는 제 세션 id에만 답한다) --session으로 잇는다
      await send(page, '테스트도 돌려줘')
      const second = turnOf(page, '테스트도 돌려줘')
      await second.locator('.turn-answer', { hasText: '테스트도 돌려줘' }).waitFor({ state: 'visible', timeout: 30_000 })
      await waitConvStatus(page, null, 'succeeded', 30_000)
      expect(await page.locator('.turn').count()).toBe(2)

      // 설정 화면 — 초록이고 "전체 허용만" 안내가 없다. 조회는 --standalone으로 간다(없으면 가짜가 exit 2 → 확인 불가)
      await page.getByRole('button', { name: '설정' }).click()
      const row = opencodeRow(page)
      await row.getByText('로그인 필요').waitFor({ state: 'visible', timeout: 20_000 })
      expect(await row.textContent()).not.toContain('전체 허용만')
    } finally {
      await app.close()
    }
  }, 120_000)

  it('확인할 수 없는 2.x(2.0.18) — 읽기 전용은 실행 전에 막히고, 전체 허용은 돌고, 설정 화면이 미리 말한다', async () => {
    const app = await launchApp({
      agentPath: FAKE_OPENCODE,
      env: {
        ONE_DESK_FAKE_OPENCODE_VERSION: '2.0.18', ONE_DESK_FAKE_OPENCODE_UNVERIFIABLE: '1', ONE_DESK_FAKE_STEP_MS: '50'
      }
    })
    try {
      const { page } = app
      await prepare(app, 'oc-v2-old')

      await page.getByLabel('권한').selectOption('read_only')
      await send(page, '읽기만 해줘')
      await waitConvStatus(page, null, 'failed', 30_000)
      await page.getByText(/실행 전에 권한을 확인할 수 없어 읽기 전용·편집 허용으로 돌릴 수 없습니다/)
        .first().waitFor({ state: 'visible', timeout: 10_000 })

      // 조용히 전체 허용으로 올리지 않는다 — 사람이 고른 전체 허용만 돈다
      await page.getByRole('button', { name: '새 대화', exact: true }).click()
      await page.getByLabel('agent', { exact: true }).selectOption('opencode')
      await page.getByLabel('권한').selectOption('full')
      await send(page, '전부 해줘')
      const turn = turnOf(page, '전부 해줘')
      await turn.locator('.turn-answer', { hasText: '가짜 OpenCode 2.x가 처리했습니다' })
        .waitFor({ state: 'visible', timeout: 30_000 })

      await page.getByRole('button', { name: '설정' }).click()
      const row = opencodeRow(page)
      await row.getByText('전체 허용만 실행됩니다 — 읽기 전용·편집 허용은 2.3.2 이상').waitFor({ state: 'visible', timeout: 20_000 })
    } finally {
      await app.close()
    }
  }, 120_000)
})
