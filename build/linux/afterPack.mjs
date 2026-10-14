// electron-builder의 afterPack 훅 — 리눅스 패키지의 Electron 실행 파일 앞에 실행 껍데기를 세운다 (docs/sdlc/linux-launch-env/).
//
// Electron 실행 파일을 `<이름>.bin`으로 옮기고 그 자리에 build/linux/launcher.sh를 둔다. AppImage의 AppRun은 `$APPDIR/<이름>`을
// exec하므로 껍데기가 먼저 돌아 사용자의 LD_LIBRARY_PATH를 걷어 낸 뒤 진짜 실행 파일을 띄운다. `process.execPath`는 `.bin`이 되고
// MCP 브리지는 그것을 직접 띄운다(그 환경은 core가 정한다 — core/runner/userEnv.ts의 appLoaderEnv).
//
// 이 훅이 돌았는지는 릴리스 CI가 만들어진 AppImage로 확인한다(build/linux/check-appimage.sh) — 돌지 않아도 빌드는 초록이다.
import { chmod, copyFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const LAUNCHER = fileURLToPath(new URL('./launcher.sh', import.meta.url))

/** @param {import('app-builder-lib').AfterPackContext} context */
export default async function afterPack(context) {
  if (context.electronPlatformName !== 'linux') return
  const exe = join(context.appOutDir, context.packager.executableName)
  await rename(exe, `${exe}.bin`)
  await copyFile(LAUNCHER, exe)
  await chmod(exe, 0o755)
}
