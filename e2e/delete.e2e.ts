import { describe, it, expect } from 'vitest'
import { launchApp } from './driver'

/**
 * 목록 줄에서 바로 지우는 길. 상세를 열지 않고 지운다.
 *
 * 단위 테스트는 렌더러 안에서만 도는 가짜 client를 보지만, 여기서는 IPC 왕복
 * (client.issues.remove → preload → ipcMain.handle → 저장소)이 실제로 돈다.
 */
describe('목록에서 삭제', () => {
  it('이슈를 목록 줄에서 지우면 사라진다', async () => {
    const app = await launchApp()
    const page = app.page

    await page.getByPlaceholder('새 workspace 이름…').fill('e2e-del')
    await page.getByPlaceholder('새 workspace 이름…').press('Enter')
    const ws = page.getByRole('button', { name: /^e2e-del$/ })
    await ws.waitFor({ state: 'visible', timeout: 10_000 })
    await ws.click()

    for (const t of ['지울 이슈', '남을 이슈']) {
      await page.getByPlaceholder('새 이슈 제목…').fill(t)
      await page.getByPlaceholder('새 이슈 제목…').press('Enter')
      await page.getByRole('button', { name: t, exact: true }).waitFor({ state: 'visible', timeout: 10_000 })
    }

    // 아이콘은 줄을 hover할 때만 폭이 풀린다. 접혀 있을 때는 폭이 0이라 아이콘
    // 자체를 hover할 수 없다(줄이 포인터를 가로챈다) — 사람이 하는 순서 그대로
    // 줄을 먼저 hover한다.
    await page.locator('li.item', { hasText: '지울 이슈' }).hover()
    await page.getByRole('button', { name: '지울 이슈 삭제' }).click()
    // 한 번으로는 안 지워진다 — 확인 라벨로 바뀌었을 뿐이다.
    await expect.poll(
      () => page.getByRole('button', { name: '지울 이슈', exact: true }).count(),
      { timeout: 2_000 }
    ).toBe(1)
    await page.getByRole('button', { name: '정말 삭제?' }).click()

    await page.getByRole('button', { name: '지울 이슈', exact: true })
      .waitFor({ state: 'detached', timeout: 10_000 })
    // 옆줄까지 쓸려가지 않는다.
    expect(await page.getByRole('button', { name: '남을 이슈', exact: true }).count()).toBe(1)
  })

  it('메모도 같은 자리에서 지운다', async () => {
    const app = await launchApp()
    const page = app.page

    await page.getByPlaceholder('새 workspace 이름…').fill('e2e-del-memo')
    await page.getByPlaceholder('새 workspace 이름…').press('Enter')
    const ws = page.getByRole('button', { name: /^e2e-del-memo$/ })
    await ws.waitFor({ state: 'visible', timeout: 10_000 })
    await ws.click()

    await page.getByPlaceholder('새 메모 제목…').fill('지울 메모')
    await page.getByPlaceholder('새 메모 제목…').press('Enter')
    await page.getByRole('button', { name: '지울 메모', exact: true })
      .waitFor({ state: 'visible', timeout: 10_000 })

    await page.locator('li.item', { hasText: '지울 메모' }).hover()
    await page.getByRole('button', { name: '지울 메모 삭제' }).click()
    await page.getByRole('button', { name: '정말 삭제?' }).click()

    await page.getByRole('button', { name: '지울 메모', exact: true })
      .waitFor({ state: 'detached', timeout: 10_000 })
  })
})
