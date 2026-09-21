import { access, constants } from 'node:fs/promises'
import { posix, win32 } from 'node:path'
import { findExecutable, isBatchShim, type LookupOptions } from '../runner/executable'

/**
 * VS Code를 **새 창으로** 여는 명령을 만든다.
 *
 * URL 스킴(`vscode://file/...`)으로는 새 창을 열 수 없다 — 마지막으로 쓰던 창을
 * 재사용하고 그 폴더를 덮어쓴다. URL에 새 창 옵션을 달라는 요청은 아직 열려 있다
 * (microsoft/vscode#141548). 그래서 CLI의 `--new-window`를 쓴다.
 *
 * **Windows에서는 PATH의 `code`를 그대로 spawn할 수 없다.** 거기 있는 것은
 * `<설치>\bin\code.cmd`인데 `.cmd`는 shell 없이 spawn하면 `EINVAL`이고
 * (CVE-2024-27980), shell을 켜면 인용 규칙이 바뀐다. 다행히 그 shim이 부르는
 * 실제 실행 파일이 바로 위 디렉토리에 있다 — `bin`의 부모가 설치 디렉토리다.
 */

/** `<설치>\bin\code.cmd` → `<설치>\Code.exe` 후보들. 파일시스템을 건드리지 않는다. */
export function vscodeExeCandidates(
  found: string,
  platform: NodeJS.Platform = process.platform
): string[] {
  // macOS·Linux의 `code`는 셸 스크립트라 그대로 spawn된다.
  if (platform !== 'win32' || !isBatchShim(found)) return [found]

  const p = win32
  const bin = p.dirname(found)
  // shim이 bin 아래에 있을 때만 설치 디렉토리를 유도할 수 있다.
  if (p.basename(bin).toLowerCase() !== 'bin') return [found]
  const install = p.dirname(bin)

  // Insiders는 실행 파일 이름에 공백이 들어간다. 안정판을 먼저 본다.
  return [p.join(install, 'Code.exe'), p.join(install, 'Code - Insiders.exe')]
}

/** 실제로 존재하는 실행 파일 하나. 없으면 null이고, 호출자가 URL로 되돌아간다. */
export async function findVscodeExecutable(opts: LookupOptions = {}): Promise<string | null> {
  const found = await findExecutable('code', opts)
  if (!found) return null

  for (const candidate of vscodeExeCandidates(found, opts.platform ?? process.platform)) {
    try {
      await access(candidate, constants.F_OK)
      return candidate
    } catch {
      // 다음 후보
    }
  }
  return null
}

/**
 * 폴더 하나를 새 창으로 여는 인자.
 *
 * `--new-window`를 매번 붙인다 — 이것이 없으면 VS Code가 기존 창을 재사용한다.
 * `--` 뒤에 경로를 두어 `-`로 시작하는 경로가 옵션으로 읽히지 않게 한다.
 */
export function newWindowArgs(folder: string, platform: NodeJS.Platform = process.platform): string[] {
  const p = platform === 'win32' ? win32 : posix
  // 끝의 구분자는 VS Code가 빈 세그먼트로 읽을 수 있다. 루트는 그대로 둔다.
  const trimmed = folder.trim()
  const normalized = trimmed.length > 1 ? trimmed.replace(/[\\/]+$/, '') : trimmed
  return ['--new-window', '--', p.normalize(normalized)]
}
