import { describe, it, expect } from 'vitest'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { launchApp } from './driver'

describe('패널 축소', () => {
  it('이슈·메모·스킬을 축소하고 다시 열어도 작성한 본문이 유지된다', async () => {
    const { page } = await launchApp()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))

    await page.getByPlaceholder('새 workspace 이름…').fill('축소 동작 확인')
    await page.getByPlaceholder('새 workspace 이름…').press('Enter')
    await page.getByRole('button', { name: '축소 동작 확인', exact: true }).click()

    const cases = [
      { panel: '이슈', placeholder: '새 이슈 (첫 줄이 제목)', title: '축소 확인 이슈' },
      { panel: '메모', placeholder: '새 메모 (첫 줄이 제목)', title: '축소 확인 메모' },
      { panel: '스킬 / 에이전트', placeholder: '새 asset 이름…', title: '축소 확인 스킬' }
    ]
    const artifacts = resolve('e2e/artifacts')
    mkdirSync(artifacts, { recursive: true })

    for (const [index, item] of cases.entries()) {
      const panel = page.getByRole('region', { name: item.panel, exact: true })
      await panel.getByPlaceholder(item.placeholder).fill(item.title)
      await panel.getByPlaceholder(item.placeholder).press('Enter')
      const title = panel.getByRole('button', { name: item.title, exact: true })
      await title.click()
      const body = panel.getByRole('textbox', { name: '본문', exact: true })
      await body.fill(`${item.title} 본문 보존 확인`)
      await page.screenshot({ path: resolve(artifacts, `collapse-${index}-expanded.png`) })
      await panel.getByRole('button', { name: '축소', exact: true }).click()
      await body.waitFor({ state: 'detached' })
      expect(await panel.getAttribute('class')).not.toContain('panel-expanded')
      expect(await panel.getByRole('button', { name: '축소', exact: true }).count()).toBe(0)
      await title.click()
      // 본문이 생겼으니 다시 열면 읽기(마크다운)로 시작한다 (docs/sdlc/item-windows/ FR-21).
      await panel.getByRole('button', { name: '원문 편집', exact: true }).click()
      await expect.poll(() => body.inputValue()).toBe(`${item.title} 본문 보존 확인`)
      await panel.getByRole('button', { name: '축소', exact: true }).click()
      await body.waitFor({ state: 'detached' })
    }

    await page.screenshot({ path: resolve(artifacts, 'collapse-all-collapsed.png') })
    expect(errors).toEqual([])
  })

  it('펼치면 목록이 상세 옆에 남고 다른 둘은 레일로 접힌다 — 레일을 누르면 세 패널로, 좁은 창에서는 상세만', async () => {
    const app = await launchApp()
    const { page } = app
    try {
      await page.getByPlaceholder('새 workspace 이름…').fill('레일 확인')
      await page.getByPlaceholder('새 workspace 이름…').press('Enter')
      await page.getByRole('button', { name: '레일 확인', exact: true }).click()

      const issues = page.getByRole('region', { name: '이슈', exact: true })
      await issues.getByPlaceholder('새 이슈 (첫 줄이 제목)').fill('레일 이슈')
      await issues.getByPlaceholder('새 이슈 (첫 줄이 제목)').press('Enter')
      const title = issues.getByRole('button', { name: '레일 이슈', exact: true })
      await title.click()
      await issues.locator('.panel-split-detail .detail-actions').waitFor()

      expect(await title.isVisible()).toBe(true)
      const list = await issues.locator('.panel-split-list').boundingBox()
      const detail = await issues.locator('.panel-split-detail').boundingBox()
      if (!list || !detail) throw new Error('목록이나 상세가 그려지지 않았다')
      expect(list.x + list.width).toBeLessThanOrEqual(detail.x)

      const rail = page.getByRole('button', { name: '메모 보기', exact: true })
      const railBox = await rail.boundingBox()
      if (!railBox) throw new Error('메모 레일이 그려지지 않았다')
      expect(railBox.width).toBeLessThan(50)
      expect(await page.getByRole('button', { name: '스킬 / 에이전트 보기', exact: true }).isVisible()).toBe(true)

      await rail.focus()
      await page.keyboard.press('Enter')
      await rail.waitFor({ state: 'detached' })
      expect(await issues.getAttribute('class')).not.toContain('panel-expanded')
      // 키보드로 누른 레일은 사라지지만 포커스는 body로 떨어지지 않고 돌아온 패널에 간다.
      expect(await page.evaluate('document.activeElement?.getAttribute("aria-label")')).toBe('메모')
      expect(await page.getByRole('region', { name: '메모', exact: true }).getByPlaceholder('새 메모 (첫 줄이 제목)').isVisible()).toBe(true)

      await title.click()
      await issues.locator('.panel-split-detail .detail-actions').waitFor()
      await app.electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1000, 700))
      await expect.poll(() => issues.locator('.panel-split-list').isVisible()).toBe(false)
      expect(await issues.locator('.panel-split-detail .detail-actions').isVisible()).toBe(true)
    } finally {
      await app.close()
    }
  })
})
