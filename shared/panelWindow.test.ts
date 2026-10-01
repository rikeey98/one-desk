import { describe, it, expect } from 'vitest'
import { panelHash, parsePanelHash, panelScopeKey, isPanelHash, type PanelScope } from './panelWindow'

describe('panelHash / parsePanelHash', () => {
  it('repo 범위를 왕복한다', () => {
    const scope: PanelScope = { kind: 'issue', workspaceId: 'w1', repoId: 'r1' }
    expect(panelHash(scope)).toBe('#panel/issue/w1/r1')
    expect(parsePanelHash(panelHash(scope))).toEqual(scope)
  })

  it('workspace 전체는 all이고 repoId가 null로 돌아온다', () => {
    const scope: PanelScope = { kind: 'asset', workspaceId: 'w1', repoId: null }
    expect(panelHash(scope)).toBe('#panel/asset/w1/all')
    expect(parsePanelHash('#panel/asset/w1/all')).toEqual(scope)
  })

  it('id 안의 / 와 % 는 인코딩되어 왕복한다', () => {
    const scope: PanelScope = { kind: 'memo', workspaceId: 'a/b', repoId: 'c%d' }
    expect(parsePanelHash(panelHash(scope))).toEqual(scope)
  })

  it('# 없이도 읽는다 (location.hash가 비어 있을 때와 구분)', () => {
    expect(parsePanelHash('panel/memo/w/r')).toEqual({ kind: 'memo', workspaceId: 'w', repoId: 'r' })
  })

  it('틀린 모양은 null이다', () => {
    expect(parsePanelHash('')).toBeNull()
    expect(parsePanelHash('#')).toBeNull()
    expect(parsePanelHash('#panel/run/w/r')).toBeNull()
    expect(parsePanelHash('#panel/issue/w')).toBeNull()
    expect(parsePanelHash('#panel/issue//r')).toBeNull()
    expect(parsePanelHash('#panel/issue/w/')).toBeNull()
    expect(parsePanelHash('#panel/issue/w/r/x')).toBeNull()
    expect(parsePanelHash('#other/issue/w/r')).toBeNull()
    expect(parsePanelHash('#panel/issue/%E0%A4%A/r')).toBeNull()
  })

  it('범위 키는 같은 범위에 같고 다른 범위에 다르다', () => {
    const a = panelScopeKey({ kind: 'issue', workspaceId: 'w', repoId: 'r' })
    expect(panelScopeKey({ kind: 'issue', workspaceId: 'w', repoId: 'r' })).toBe(a)
    expect(panelScopeKey({ kind: 'memo', workspaceId: 'w', repoId: 'r' })).not.toBe(a)
    expect(panelScopeKey({ kind: 'issue', workspaceId: 'w', repoId: null })).not.toBe(a)
    expect(panelScopeKey({ kind: 'issue', workspaceId: 'w2', repoId: 'r' })).not.toBe(a)
  })
})

describe('isPanelHash', () => {
  it('#panel/로 시작하면 모양이 틀려도 패널 창이다 — 앱 창을 대신 그리지 않는다', () => {
    expect(isPanelHash('#panel/issue/w/r')).toBe(true)
    expect(isPanelHash('#panel/run/w')).toBe(true)
    expect(isPanelHash('')).toBe(false)
    expect(isPanelHash('#other')).toBe(false)
  })
})
