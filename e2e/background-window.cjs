/**
 * e2e의 앱 창이 사람의 화면을 가로채지 않게 한다. Electron의 `-r`로 앱보다 먼저 실린다(`e2e/driver.ts`) — 제품 코드에 테스트
 * 분기를 두지 않는다. 앱의 모든 창은 `createWindow`가 `show: false`로 만들고 `ready-to-show`에서 `win.show()`를 부르므로, 만들어지는
 * 순간 그 창의 `show`·`focus`를 갈아 끼우면 첫 표시부터 잡힌다. `.cjs`인 것은 `"type": "module"` 아래에서 `require`를 쓰기 위해서다.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- `-r`로 실리는 모듈은 CommonJS다
const { app } = require('electron')

/** 어느 모니터 배치에서도 닿지 않는 자리 — -32000은 Windows가 최소화한 창에 쓰는 값이라 피한다 */
const OFFSCREEN = -20000

app.on('browser-window-created', (_event, win) => {
  win.setPosition(OFFSCREEN, OFFSCREEN)
  win.setSkipTaskbar(true)
  win.show = () => { win.showInactive() }
  // 패널·그림 창을 다시 열 때의 `focus()`가 사람의 입력을 가져가지 않게. Playwright의 입력은 CDP로 가서 OS 포커스가 필요 없다
  win.focus = () => {}
})
