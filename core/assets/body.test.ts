import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readAssetBody } from './body'
import type { Asset } from '@shared/models'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'one-desk-body-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

function row(over: Partial<Asset>): Asset {
  return {
    id: 'a1', workspaceId: 'w1', kind: 'skill', source: 'discovered', name: '알파',
    description: null, repoId: 'r1', filePath: null, content: null, lastSeenAt: 1,
    createdAt: 0, updatedAt: 0, ...over
  }
}

describe('readAssetBody', () => {
  it('authored는 DB의 본문이다', async () => {
    expect(await readAssetBody(row({ source: 'authored', content: '앱에서 쓴 것' })))
      .toEqual({ ok: true, content: '앱에서 쓴 것' })
  })

  it('discovered는 그 파일의 지금 내용이다', async () => {
    const file = join(dir, 'SKILL.md')
    writeFileSync(file, '# 지금 내용\n')
    expect(await readAssetBody(row({ filePath: file })))
      .toEqual({ ok: true, content: '# 지금 내용\n' })
  })

  it('없는 파일은 던지지 않고 경로가 든 실패로 온다', async () => {
    const file = join(dir, '없음.md')
    const result = await readAssetBody(row({ filePath: file }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain(file)
  })

  it('filePath가 없는 discovered(깨진 행)도 던지지 않는다', async () => {
    const result = await readAssetBody(row({ filePath: null }))
    expect(result.ok).toBe(false)
  })
})
