import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import * as fsp from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { portableUnpackOf, removePortableLeftovers, type PortableUnpack } from './portableUnpack'

/**
 * Windows 포터블 실행 파일의 압축 해제 폴더 (`docs/sdlc/portable-unpack/`). 래퍼는 실행마다 `<TEMP>\nsXXXX.tmp\app`에 앱을 풀고
 * 앱이 끝나면 그 폴더를 지운다 — 비정상 종료(전원·로그오프로 래퍼가 먼저 끝남)가 남긴 것은 다음 실행이 치운다.
 */
const TEMP = 'C:\\Users\\me\\AppData\\Local\\Temp'
const ENV = { PORTABLE_EXECUTABLE_FILE: 'D:\\Downloads\\one-desk-0.26.3-x64.exe' }

describe('portableUnpackOf — 래퍼가 이 실행을 위해 만든 폴더에서 도는가', () => {
  // NSIS는 `ns` 뒤에 영문자 하나(a~z)와 GetTempFileName의 16진수를 붙인다 — 실측한 이름과, 16진수가 아닌 글자가 걸린 이름
  it.each(['nscC36B.tmp', 'nszA1B2.tmp'])('<TEMP>\\%s\\app\\<exe>이고 래퍼의 표식이 있으면 그 배치를 준다', (name) => {
    expect(portableUnpackOf(`${TEMP}\\${name}\\app\\one-desk.exe`, ENV, 'win32')).toEqual({
      tempDir: TEMP, ownDir: `${TEMP}\\${name}`, exeName: 'one-desk.exe'
    })
  })

  it.each([
    ['래퍼의 표식(PORTABLE_EXECUTABLE_FILE)이 없다 — 압축을 푼 폴더를 직접 실행했다', `${TEMP}\\nsA1B2.tmp\\app\\one-desk.exe`, {}, 'win32'],
    ['예전 배치 — 빌드마다 고정된 이름 하나(v0.26.2까지)', `${TEMP}\\3Kit3xnVA63YkYGmIK6459SGHCb\\one-desk.exe`, ENV, 'win32'],
    ['app 아래가 아니다', `${TEMP}\\nsA1B2.tmp\\bin\\one-desk.exe`, ENV, 'win32'],
    ['NSIS 폴더 이름이 아니다', `${TEMP}\\other\\app\\one-desk.exe`, ENV, 'win32'],
    ['Windows가 아니다', '/tmp/nsA1B2.tmp/app/one-desk', ENV, 'linux']
  ] as const)('%s → null', (_, execPath, env, platform) => {
    expect(portableUnpackOf(execPath, env, platform)).toBeNull()
  })
})

describe('removePortableLeftovers — 비정상 종료가 남긴 압축 해제 폴더', () => {
  let temp: string
  let unpack: PortableUnpack

  /** 래퍼가 푼 것처럼 — `<dir>\app\<exe>`와 resources 몇 개 */
  function extracted(name: string, exe = 'one-desk.exe'): string {
    const dir = join(temp, name)
    mkdirSync(join(dir, 'app', 'resources', 'app.asar.unpacked', 'node_modules', 'node-pty'), { recursive: true })
    writeFileSync(join(dir, 'System.dll'), 'nsis plugin')
    writeFileSync(join(dir, 'app', exe), 'exe')
    writeFileSync(join(dir, 'app', 'resources', 'app.asar'), 'asar')
    writeFileSync(join(dir, 'app', 'resources', 'wsl-launcher.sh'), '#!/bin/sh')
    writeFileSync(join(dir, 'app', 'resources', 'app.asar.unpacked', 'node_modules', 'node-pty', 'pty.node'), 'native')
    return dir
  }

  beforeEach(() => {
    temp = mkdtempSync(join(tmpdir(), 'one-desk-portable-'))
    unpack = { tempDir: temp, ownDir: extracted('nsA1.tmp'), exeName: 'one-desk.exe' }
  })
  afterEach(() => { rmSync(temp, { recursive: true, force: true }) })

  it('끝난 실행의 폴더는 통째로 지우고, 지금 실행의 폴더는 건드리지 않는다', async () => {
    const dead = extracted('nsqB2F1.tmp')
    expect(await removePortableLeftovers(unpack, fsp)).toEqual([dead])
    expect(existsSync(dead)).toBe(false)
    expect(readdirSync(temp)).toEqual(['nsA1.tmp'])
    expect(existsSync(join(unpack.ownDir, 'app', 'resources', 'wsl-launcher.sh'))).toBe(true)
  })

  it('실행 파일이 지워지지 않는 폴더(다른 인스턴스가 돌고 있다)는 파일 하나 건드리지 않는다', async () => {
    const live = extracted('nsC3.tmp')
    const before = readdirSync(live, { recursive: true }).sort()
    const busy = Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' })
    const removed = await removePortableLeftovers(unpack, {
      ...fsp,
      unlink: async (p) => { if (p === join(live, 'app', 'one-desk.exe')) throw busy; await fsp.unlink(p) }
    })
    expect(removed).toEqual([])
    expect(readdirSync(live, { recursive: true }).sort()).toEqual(before)
  })

  it.each([
    ['다른 앱의 압축 해제 폴더 (실행 파일 이름이 다르다)', () => extracted('nsD4.tmp', 'other-app.exe')],
    ['NSIS 폴더 이름이 아니다', () => extracted('3Kit3xnVA63YkYGmIK6459SGHCb')],
    ['아직 풀고 있다 — 실행 파일이 아직 없다', () => { const d = extracted('nsE5.tmp'); rmSync(join(d, 'app', 'one-desk.exe')); return d }]
  ])('%s는 남긴다', async (_, make) => {
    const dir = make()
    expect(await removePortableLeftovers(unpack, fsp)).toEqual([])
    expect(existsSync(join(dir, 'app', 'resources', 'app.asar'))).toBe(true)
  })

  it('지우다 막히면 지웠다고 하지 않고, 휴지통 이름으로 남겨 다음 정리가 마저 지운다', async () => {
    const dead = extracted('nsB2.tmp')
    const blocked = Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' })
    expect(await removePortableLeftovers(unpack, { ...fsp, rm: async () => { throw blocked } })).toEqual([])
    const left = readdirSync(temp).filter((n) => n !== 'nsA1.tmp')
    expect(left).toEqual([expect.stringMatching(/^one-desk-leftover-/)])
    expect(existsSync(dead)).toBe(false)

    expect(await removePortableLeftovers(unpack, fsp)).toEqual([join(temp, left[0]!)])
    expect(readdirSync(temp)).toEqual(['nsA1.tmp'])
  })

  it('TEMP를 못 읽으면 던지지 않고 아무것도 지우지 않는다', async () => {
    expect(await removePortableLeftovers({ ...unpack, tempDir: join(temp, 'missing') }, fsp)).toEqual([])
  })
})

/**
 * 실행마다 새 폴더는 electron-builder의 `portable.unpackDirName`이 정한다 — **문서와 반대로 `true`여야 한다.** 문서는 `false`가
 * "실행마다 고유한 $PLUGINSDIR"라지만 26.15.3·26.17.0의 코드는 `false`를 기본값처럼 다뤄 빌드마다 고정된 이름을 쓰고(실측 —
 * 두 번째 실행이 그 폴더를 지웠다), `true`일 때만 UNPACK_DIR_NAME을 정의하지 않아 템플릿이 `$PLUGINSDIR\app`을 쓴다.
 * electron-builder를 올리다 이 판정이 바뀌면 여기가 빨개진다 — 포터블 exe를 두 번 실행해 첫 인스턴스의 resources가 남는지 다시 볼 것.
 */
describe('electron-builder가 포터블을 실행마다 새 폴더에 푼다 (portable.unpackDirName: true)', () => {
  const root = join(__dirname, '../..')
  const builder = createRequire(join(root, 'package.json')).resolve('electron-builder/package.json')
  const appBuilderLib = dirname(createRequire(builder).resolve('app-builder-lib/package.json'))

  it('electron-builder.yml이 unpackDirName: true를 준다', () => {
    expect(readFileSync(join(root, 'electron-builder.yml'), 'utf8')).toMatch(/^portable:\r?\n\s+unpackDirName: true\s*$/m)
  })

  it('true면 UNPACK_DIR_NAME을 정의하지 않는다', () => {
    const target = readFileSync(join(appBuilderLib, 'out/targets/nsis/NsisTarget.js'), 'utf8')
    expect(target).toContain('if (typeof unpackDirName === "string" || !unpackDirName) {')
  })

  it('UNPACK_DIR_NAME이 없으면 템플릿이 $PLUGINSDIR\\app에 푼다', () => {
    const nsi = readFileSync(join(appBuilderLib, 'templates/nsis/portable.nsi'), 'utf8')
    expect(nsi).toContain('StrCpy $INSTDIR "$PLUGINSDIR\\app"\n  !ifdef UNPACK_DIR_NAME')
  })
})
