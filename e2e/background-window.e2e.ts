import { describe, it, expect } from 'vitest'
import type { ElectronApplication } from 'playwright-core'
import { launchApp } from './driver'

function windowState(electron: ElectronApplication) {
  return electron.evaluate(({ BrowserWindow, screen }) => {
    const w = BrowserWindow.getAllWindows()[0]!
    w.focus()
    const b = w.getBounds()
    return {
      visible: w.isVisible(),
      focused: w.isFocused(),
      onScreen: screen.getAllDisplays().some(({ bounds: d }) =>
        b.x < d.x + d.width && b.x + b.width > d.x && b.y < d.y + d.height && b.y + b.height > d.y)
    }
  })
}

/**
 * e2e가 사람의 화면을 가로채지 않는다 (`e2e/background-window.cjs`). 앱을 띄울 때마다 창이 화면 한가운데에 뜨고 포커스를 가져가면
 * 도는 동안 다른 일을 못 한다(실측: 뜬 지 11ms 만에 전경 창이 바뀌었다). 창은 화면 밖에 서되 렌더러는 멈추지 않아야 한다 — 멈추면
 * Excalidraw·xterm·스크린샷이 매달린다.
 */
describe('e2e의 앱 창', () => {
  it('화면 밖에 떠서 포커스를 가져가지 않지만, 렌더러는 멈추지 않는다', async () => {
    const app = await launchApp()
    const page = app.page
    await page.getByPlaceholder('새 workspace 이름…').waitFor({ state: 'visible', timeout: 10_000 })

    // 창은 첫 그림 뒤의 ready-to-show에서야 서므로 기다린다 — 그 전의 focused·onScreen은 아무것도 말하지 않는다
    await expect.poll(async () => (await windowState(app.electron)).visible, { timeout: 5_000 }).toBe(true)
    expect(await windowState(app.electron)).toEqual({ visible: true, focused: false, onScreen: false })

    expect(await page.evaluate('document.visibilityState')).toBe('visible')
    expect(await page.evaluate('new Promise((r) => requestAnimationFrame(() => r(true)))')).toBe(true)
  })
})
