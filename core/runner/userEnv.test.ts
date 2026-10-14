import { describe, it, expect, afterEach } from 'vitest'
import { spawn } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ORIGINAL_LD_LIBRARY_PATH, appLoaderEnv, userProcessEnv } from './userEnv'

/**
 * 리눅스 패키지의 실행 껍데기와 core가 나눠 가진 약속 (`docs/sdlc/linux-launch-env/`). 껍데기(`build/linux/launcher.sh`)는
 * Electron을 사용자의 `LD_LIBRARY_PATH` 없이 띄우고 그 값을 표식에 남긴다. core는 사용자 대신 띄우는 프로세스에 그 값을
 * 되돌려 주고(`userProcessEnv`), 앱 자신의 실행 파일을 다시 띄울 때(MCP 브리지)는 앱이 뜬 값을 얹는다(`appLoaderEnv`).
 */
const LAUNCHER = fileURLToPath(new URL('../../build/linux/launcher.sh', import.meta.url))
const AFTER_PACK = fileURLToPath(new URL('../../build/linux/afterPack.mjs', import.meta.url))

describe('userProcessEnv', () => {
  it('표식이 없으면(Windows·macOS·pnpm dev) 환경을 그대로 복사한다 — LD_LIBRARY_PATH도 손대지 않는다', () => {
    const env = { PATH: '/usr/bin', LD_LIBRARY_PATH: '/opt/eda/lib' }
    const out = userProcessEnv(env)
    expect(out).toEqual(env)
    expect(out).not.toBe(env)
  })

  it('표식이 있으면 LD_LIBRARY_PATH를 사용자가 실행한 값으로 되돌리고 표식을 지운다', () => {
    const out = userProcessEnv({
      PATH: '/usr/bin',
      LD_LIBRARY_PATH: '/tmp/.mount_one-dAbC/usr/lib',
      [ORIGINAL_LD_LIBRARY_PATH]: '/opt/eda/lib'
    })
    expect(out).toEqual({ PATH: '/usr/bin', LD_LIBRARY_PATH: '/opt/eda/lib' })
  })

  it('표식이 빈 값이면 사용자가 그 변수를 두지 않은 것이다 — 자식에게도 두지 않는다', () => {
    const out = userProcessEnv({ LD_LIBRARY_PATH: '/tmp/.mount_one-dAbC/usr/lib', [ORIGINAL_LD_LIBRARY_PATH]: '' })
    expect(out).toEqual({})
    expect('LD_LIBRARY_PATH' in out).toBe(false)
  })

  it('사용자의 값을 글자 그대로 돌려준다 — 빈 칸(= 현재 디렉토리)도 지우거나 합치지 않는다', () => {
    const out = userProcessEnv({ LD_LIBRARY_PATH: '/app/usr/lib', [ORIGINAL_LD_LIBRARY_PATH]: '/a::/b:' })
    expect(out['LD_LIBRARY_PATH']).toBe('/a::/b:')
  })

  it('받은 환경을 바꾸지 않는다 — process.env를 넘겨도 앱 자신의 값은 그대로다', () => {
    const env = { LD_LIBRARY_PATH: '/app/usr/lib', [ORIGINAL_LD_LIBRARY_PATH]: '/opt/eda/lib' }
    userProcessEnv(env)
    expect(env).toEqual({ LD_LIBRARY_PATH: '/app/usr/lib', [ORIGINAL_LD_LIBRARY_PATH]: '/opt/eda/lib' })
  })

  it('값이 undefined인 키는 싣지 않는다', () => {
    expect(userProcessEnv({ A: 'a', B: undefined })).toEqual({ A: 'a' })
  })
})

describe('appLoaderEnv — 앱 자신의 실행 파일(MCP 브리지)에 얹을 것', () => {
  it('표식이 없으면 얹을 것이 없다 — 브리지는 agent의 환경을 그대로 물려받는다', () => {
    expect(appLoaderEnv({ LD_LIBRARY_PATH: '/opt/eda/lib' })).toEqual({})
  })

  it('표식이 있으면 앱이 뜬 LD_LIBRARY_PATH를 준다 — agent가 물려준 사용자의 값을 덮는다', () => {
    expect(appLoaderEnv({ LD_LIBRARY_PATH: '/tmp/.mount_one-dAbC/usr/lib', [ORIGINAL_LD_LIBRARY_PATH]: '/opt/eda/lib' }))
      .toEqual({ LD_LIBRARY_PATH: '/tmp/.mount_one-dAbC/usr/lib' })
  })

  it('앱이 그 변수 없이 떴으면 빈 값을 준다 — glibc는 빈 LD_LIBRARY_PATH를 없는 것으로 본다', () => {
    expect(appLoaderEnv({ [ORIGINAL_LD_LIBRARY_PATH]: '/opt/eda/lib' })).toEqual({ LD_LIBRARY_PATH: '' })
  })
})

// **Windows에서도 돈다** — 릴리스 CI의 Windows 러너가 아니라 리눅스 러너가 패키징하지만, 이 장비처럼 Windows에서 체크아웃한
// 파일이 CRLF가 되면 리눅스의 /bin/sh가 `$'\r': command not found`로 거부해 앱이 아예 뜨지 않는다(`.gitattributes`가 막는다).
describe('build/linux/launcher.sh — 모든 플랫폼', () => {
  it('CR이 없다 — LF로만 끝나야 리눅스의 /bin/sh가 읽는다', () => {
    expect(readFileSync(LAUNCHER).includes(0x0d)).toBe(false)
  })

  it('표식 이름이 core의 상수와 같다 — 다르면 자식에게 사용자의 값이 돌아가지 않는다', () => {
    const text = readFileSync(LAUNCHER, 'utf8')
    expect(text).toContain(`${ORIGINAL_LD_LIBRARY_PATH}=`)
    expect(text).toContain(`export ${ORIGINAL_LD_LIBRARY_PATH}`)
  })

  it('afterPack 훅이 옮긴 이름(<실행 파일>.bin)을 껍데기가 exec한다 — 둘이 갈리면 AppImage가 시작조차 못 한다', () => {
    expect(readFileSync(LAUNCHER, 'utf8')).toContain('exec "$self.bin" "$@"')
    expect(readFileSync(AFTER_PACK, 'utf8')).toContain('`${exe}.bin`')
  })
})

/**
 * 껍데기를 진짜 sh로 돌린다. AppDir 흉내: `<dir>/app/one-desk`(껍데기)와 `<dir>/app/one-desk.bin`(받은 환경과 인자를 찍는
 * 스크립트). AppImage에서는 `<AppDir>/usr/lib`이 있고 AppRun이 그것을 LD_LIBRARY_PATH 앞에 붙여 껍데기를 부른다.
 */
describe.skipIf(process.platform === 'win32')('build/linux/launcher.sh', () => {
  const dirs: string[] = []
  afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

  function appDir(opts: { usrLib: boolean }): { root: string; app: string } {
    // realpath — macOS의 /tmp는 /private/tmp의 심볼릭 링크라 껍데기의 readlink -f와 글자가 갈린다
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'one-desk-launch-')))
    dirs.push(root)
    const app = join(root, 'app')
    mkdirSync(app)
    if (opts.usrLib) mkdirSync(join(app, 'usr', 'lib'), { recursive: true })
    copyFileSync(LAUNCHER, join(app, 'one-desk'))
    chmodSync(join(app, 'one-desk'), 0o755)
    writeFileSync(join(app, 'one-desk.bin'), [
      '#!/bin/sh',
      'printf "LD=%s\\n" "${LD_LIBRARY_PATH-<unset>}"',
      `printf "ORIG=%s\\n" "\${${ORIGINAL_LD_LIBRARY_PATH}-<unset>}"`,
      'for a in "$@"; do printf "ARG=%s\\n" "$a"; done',
      ''
    ].join('\n'))
    chmodSync(join(app, 'one-desk.bin'), 0o755)
    return { root, app }
  }

  function run(exe: string, env: Record<string, string>, args: string[] = []) {
    return new Promise<{ code: number | null; lines: string[] }>((resolve) => {
      const child = spawn(exe, args, { env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin', ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
      let out = ''
      child.stdout.on('data', (c: Buffer) => { out += c.toString('utf8') })
      child.on('close', (code) => resolve({ code, lines: out.split('\n').filter(Boolean) }))
    })
  }

  it('AppRun이 붙인 앞자리를 떼어 사용자의 값을 표식에 남기고, Electron은 AppImage의 usr/lib만 보고 뜬다', async () => {
    const { app } = appDir({ usrLib: true })
    const out = await run(join(app, 'one-desk'), { LD_LIBRARY_PATH: `${app}/usr/lib:/opt/eda/lib` })
    expect(out.code).toBe(0)
    expect(out.lines).toEqual([`LD=${app}/usr/lib`, 'ORIG=/opt/eda/lib'])
  })

  it('사용자가 그 변수를 두지 않았으면 표식은 빈 값이다 — 없는 것과 가를 수 있게 늘 남긴다', async () => {
    const { app } = appDir({ usrLib: true })
    const out = await run(join(app, 'one-desk'), { LD_LIBRARY_PATH: `${app}/usr/lib` })
    expect(out.lines).toEqual([`LD=${app}/usr/lib`, 'ORIG='])
  })

  it('사용자의 값을 글자 그대로 남긴다 — 빈 칸을 지우거나 합치지 않는다', async () => {
    const { app } = appDir({ usrLib: true })
    const out = await run(join(app, 'one-desk'), { LD_LIBRARY_PATH: `${app}/usr/lib:/a::/b:` })
    expect(out.lines).toContain('ORIG=/a::/b:')
  })

  it('AppRun 없이 띄우면(usr/lib이 없는 linux-unpacked) Electron은 그 변수 없이 뜨고 값 전체가 사용자의 것이다', async () => {
    const { app } = appDir({ usrLib: false })
    const out = await run(join(app, 'one-desk'), { LD_LIBRARY_PATH: '/opt/eda/lib' })
    expect(out.lines).toEqual(['LD=<unset>', 'ORIG=/opt/eda/lib'])
  })

  it('APPDIR이 심볼릭 링크를 거친 경로여도 AppRun의 앞자리를 알아본다', async () => {
    const { root, app } = appDir({ usrLib: true })
    const link = join(root, 'mount')
    symlinkSync(app, link)
    const out = await run(join(link, 'one-desk'), { APPDIR: link, LD_LIBRARY_PATH: `${link}/usr/lib:/opt/eda/lib` })
    expect(out.lines).toEqual([`LD=${app}/usr/lib`, 'ORIG=/opt/eda/lib'])
  })

  it('껍데기를 가리키는 심볼릭 링크로 불러도 진짜 실행 파일을 찾는다', async () => {
    const { root, app } = appDir({ usrLib: false })
    const bin = join(root, 'bin')
    mkdirSync(bin)
    symlinkSync(join(app, 'one-desk'), join(bin, 'one-desk'))
    const out = await run(join(bin, 'one-desk'), {})
    expect(out.code).toBe(0)
    expect(out.lines).toEqual(['LD=<unset>', 'ORIG='])
  })

  it('인자를 그대로 넘긴다 — 공백·따옴표·$가 뜻을 잃지 않는다', async () => {
    const { app } = appDir({ usrLib: false })
    const out = await run(join(app, 'one-desk'), {}, ['a b', '"q"', '$HOME', '--no-sandbox', ''])
    expect(out.lines.filter((l) => l.startsWith('ARG='))).toEqual(['ARG=a b', 'ARG="q"', 'ARG=$HOME', 'ARG=--no-sandbox', 'ARG='])
  })
})
