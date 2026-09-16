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
      { panel: 'Issues', placeholder: '새 이슈 제목…', title: '축소 확인 이슈' },
      { panel: 'Memos', placeholder: '새 메모 제목…', title: '축소 확인 메모' },
      { panel: 'Skills / Agents', placeholder: '새 asset 이름…', title: '축소 확인 스킬' }
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
      await expect.poll(() => body.inputValue()).toBe(`${item.title} 본문 보존 확인`)
      await panel.getByRole('button', { name: '축소', exact: true }).click()
      await body.waitFor({ state: 'detached' })
    }

    await page.screenshot({ path: resolve(artifacts, 'collapse-all-collapsed.png') })
    expect(errors).toEqual([])
  })
})
