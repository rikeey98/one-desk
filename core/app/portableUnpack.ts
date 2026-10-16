import { randomUUID } from 'node:crypto'
import type * as FsPromises from 'node:fs/promises'
import { join, win32 } from 'node:path'

/**
 * Windows 포터블 실행 파일이 이 실행을 위해 푼 폴더 (`docs/sdlc/portable-unpack/`).
 *
 * 래퍼(electron-builder의 portable.nsi)는 `portable.unpackDirName: true`일 때 **실행마다** `<TEMP>\nsXXXX.tmp\app`에 앱을 풀고,
 * 앱이 끝나면 그 폴더를 지운다. 빌드마다 고정된 이름 하나를 쓰던 v0.26.2까지는 앱이 떠 있는 동안 같은 exe를 다시 실행하면 두 번째
 * 래퍼가 그 폴더를 지워 첫 인스턴스가 나중에 읽는 파일(`wsl-launcher.sh`·`mcp-bridge.mjs`·node-pty)이 사라졌다.
 */
export interface PortableUnpack {
  /** 래퍼가 본 TEMP — 압축 해제 폴더들의 부모 */
  tempDir: string
  /** 이 실행의 폴더(`<TEMP>\nsXXXX.tmp`) — 정리하지 않는다 */
  ownDir: string
  /** 앱 실행 파일 이름(`one-desk.exe`) — 남은 폴더가 이 앱의 것인지, 아직 도는지를 그것으로 가린다 */
  exeName: string
}

/**
 * NSIS가 `$PLUGINSDIR`로 만드는 폴더 이름 — `ns` + 아무 영문자 하나(접두사 `nsa`에 틱 수 % 26을 더한다) + GetTempFileName의
 * 16진수(실측 `nscC36B.tmp`). 16진수만 받으면 g~z가 걸린 실행을 놓친다. 이 앱의 것인지는 이름이 아니라 안의 실행 파일로 가린다.
 */
const NSIS_DIR = /^ns[0-9a-z]{1,9}\.tmp$/i
/** 이름을 바꿔 둔 뒤 지우다 만 폴더 — 이 이름은 이 앱만 만든다 */
const TRASH_PREFIX = 'one-desk-leftover-'

/**
 * 이 프로세스가 래퍼가 실행마다 만든 폴더에서 돌고 있으면 그 배치를, 아니면 null을 준다. 래퍼는 `PORTABLE_EXECUTABLE_FILE`을
 * 남긴다 — 그것이 없으면(압축을 푼 폴더를 직접 실행했다, 개발·e2e) 정리하지 않는다. 고정 이름을 쓰던 예전 배치도 null이다.
 */
export function portableUnpackOf(execPath: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): PortableUnpack | null {
  if (platform !== 'win32' || !env['PORTABLE_EXECUTABLE_FILE']) return null
  const appDir = win32.dirname(execPath)
  if (win32.basename(appDir).toLowerCase() !== 'app') return null
  const ownDir = win32.dirname(appDir)
  if (!NSIS_DIR.test(win32.basename(ownDir))) return null
  return { tempDir: win32.dirname(ownDir), ownDir, exeName: win32.basename(execPath) }
}

/**
 * 정리에 쓰는 파일 함수. **Electron에서는 `original-fs`의 것이어야 한다** — Electron의 `fs`는 `.asar` 파일을 폴더처럼 보여 줘,
 * `rm`이 남은 `app.asar` 안으로 들어가 지우려다 실패하고 그 파일(55 MB, 압축 해제 폴더마다 둘)이 남는다(실측). 일반 Node에서 도는
 * 단위 테스트는 이것을 못 본다 — 그래서 선택 인자로 두지 않는다(빠뜨리면 조용히 Electron의 `fs`로 돈다).
 */
export type LeftoverFs = Pick<typeof FsPromises, 'readdir' | 'rename' | 'rm' | 'unlink'>

/**
 * 비정상 종료(전원·로그오프로 래퍼가 정리하기 전에 끝남)가 남긴 압축 해제 폴더를 지우고, 지운 폴더를 돌려준다.
 *
 * **도는 인스턴스의 폴더는 건드리지 않는다** — 그것이 고치려던 결함이다. 그래서 `app\<exe>`를 **먼저 지워 본다**: 실행 중인 실행
 * 파일은 Windows가 지우지 못하게 하므로, 지워지면 그 폴더의 앱은 돌고 있지 않다. 실행 파일이 없어 못 지운 폴더(다른 앱의 것,
 * 아직 푸는 중)도 같은 길로 남는다. 실행 파일을 지운 뒤에는 이름을 이 앱만 쓰는 휴지통 이름으로 바꿔 지우므로, 지우다
 * 막히면(백신이 파일을 쥐고 있다) 다음 실행이 그 이름으로 찾아 마저 지운다. 실패는 전부 삼킨다 — 정리일 뿐이다.
 */
export async function removePortableLeftovers(unpack: PortableUnpack, fs: LeftoverFs): Promise<string[]> {
  const removeTree = (dir: string) => fs.rm(dir, { recursive: true, force: true, maxRetries: 2 }).then(() => true, () => false)
  let names: string[]
  try {
    names = (await fs.readdir(unpack.tempDir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return []
  }
  const own = win32.basename(unpack.ownDir).toLowerCase()
  const removed: string[] = []
  for (const name of names) {
    const dir = join(unpack.tempDir, name)
    if (name.startsWith(TRASH_PREFIX)) {
      if (await removeTree(dir)) removed.push(dir)
      continue
    }
    if (!NSIS_DIR.test(name) || name.toLowerCase() === own) continue
    try {
      await fs.unlink(join(dir, 'app', unpack.exeName))
    } catch {
      continue
    }
    const trash = join(unpack.tempDir, `${TRASH_PREFIX}${randomUUID()}`)
    const target = await fs.rename(dir, trash).then(() => trash, () => dir)
    if (await removeTree(target)) removed.push(dir)
  }
  return removed
}
