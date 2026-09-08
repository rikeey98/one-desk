import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClientProvider } from '../client/ClientProvider'
import { AssetDetail } from './AssetDetail'
import type { Asset } from '@shared/models'
import type { OneDeskClient } from '@shared/client'

function asset(over: Partial<Asset> = {}): Asset {
  return {
    id: 'a1', workspaceId: 'w1', kind: 'skill', source: 'authored',
    name: '내 스킬', description: null, repoId: null, filePath: null,
    content: '처음', lastSeenAt: null, createdAt: 0, updatedAt: 1, ...over
  }
}

function makeClient(over: Record<string, unknown> = {}): OneDeskClient {
  return {
    assets: {
      list: vi.fn().mockResolvedValue([]),
      createAuthored: vi.fn(),
      updateIfUnchanged: vi.fn().mockResolvedValue({ ok: true, asset: asset({ updatedAt: 2 }) }),
      remove: vi.fn(),
      rescan: vi.fn(),
      ...over
    }
  } as unknown as OneDeskClient
}

function renderDetail(a: Asset, over: Record<string, unknown> = {}) {
  const client = makeClient(over)
  render(
    <ClientProvider client={client}>
      <AssetDetail asset={a} onChanged={vi.fn()} onDeleted={vi.fn()} />
    </ClientProvider>
  )
  return client
}

describe('AssetDetail', () => {
  it('discovered는 읽기 전용이고 경로를 보여준다', async () => {
    // 본문은 파일이 원본이다. 앱이 고치면 어느 쪽이 진짜인지 알 수 없게 된다 (설계 §6-2).
    renderDetail(asset({
      source: 'discovered', filePath: '/tmp/api/SKILL.md', content: null, lastSeenAt: 5
    }))
    expect(await screen.findByText('/tmp/api/SKILL.md')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '본문' })).toHaveAttribute('readonly')
    expect(screen.getByRole('textbox', { name: '이름' })).toHaveAttribute('readonly')
  })

  it('authored 본문을 고치면 저장된다', async () => {
    const client = renderDetail(asset({ content: '처음', updatedAt: 1 }))
    await userEvent.type(screen.getByRole('textbox', { name: '본문' }), '!')
    await waitFor(() => expect(client.assets.updateIfUnchanged).toHaveBeenCalledWith(
      expect.objectContaining({ expectedUpdatedAt: 1 })
    ))
  })

  it('성공한 저장마다 기대값을 갱신한다', async () => {
    // 안 하면 다음 자동 저장이 낡은 expectedUpdatedAt을 들고 가 자기 자신과 충돌한다.
    const updateIfUnchanged = vi.fn()
      .mockResolvedValueOnce({ ok: true, asset: asset({ updatedAt: 2 }) })
      .mockResolvedValueOnce({ ok: true, asset: asset({ updatedAt: 3 }) })
    renderDetail(asset({ content: '처음', updatedAt: 1 }), { updateIfUnchanged })

    const box = screen.getByRole('textbox', { name: '본문' })
    await userEvent.type(box, 'a')
    await waitFor(() => expect(updateIfUnchanged).toHaveBeenCalledTimes(1))
    await userEvent.type(box, 'b')
    await waitFor(() => expect(updateIfUnchanged).toHaveBeenCalledTimes(2))

    expect(updateIfUnchanged.mock.calls[1]![0]).toMatchObject({ expectedUpdatedAt: 2 })
  })

  it('충돌하면 배너를 띄운다', async () => {
    const updateIfUnchanged = vi.fn().mockResolvedValue({
      ok: false, current: asset({ content: '남이 고침', updatedAt: 9 })
    })
    renderDetail(asset({ content: '처음', updatedAt: 1 }), { updateIfUnchanged })
    await userEvent.type(screen.getByRole('textbox', { name: '본문' }), '!')
    expect(await screen.findByRole('alert')).toHaveTextContent(/바뀌었습니다/)
  })

  it('다시 불러오기는 저장된 값으로 되돌린다', async () => {
    const updateIfUnchanged = vi.fn().mockResolvedValue({
      ok: false, current: asset({ content: '남이 고침', updatedAt: 9 })
    })
    renderDetail(asset({ content: '처음', updatedAt: 1 }), { updateIfUnchanged })
    await userEvent.type(screen.getByRole('textbox', { name: '본문' }), '!')
    await screen.findByRole('alert')

    await userEvent.click(screen.getByRole('button', { name: '다시 불러오기' }))
    expect(screen.getByRole('textbox', { name: '본문' })).toHaveValue('남이 고침')
  })
})
