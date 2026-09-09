import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClientProvider } from '../client/ClientProvider'
import { SettingsPanel } from './SettingsPanel'
import type { OneDeskClient } from '@shared/client'
import type { GlobalRoots } from '@shared/models'

const DEFAULTS: GlobalRoots = {
  claude: ['/home/me/.claude/skills', '/home/me/.claude/agents'],
  opencode: ['/home/me/.config/opencode/agent']
}

function makeClient(over: Record<string, unknown> = {}): OneDeskClient {
  return {
    settings: {
      globalRoots: vi.fn().mockResolvedValue(DEFAULTS),
      setGlobalRoots: vi.fn().mockResolvedValue(DEFAULTS),
      ...over
    }
  } as unknown as OneDeskClient
}

function renderPanel(client: OneDeskClient) {
  render(<ClientProvider client={client}><SettingsPanel /></ClientProvider>)
  return client
}

describe('SettingsPanel', () => {
  it('저장된 경로를 줄바꿈으로 보여준다', async () => {
    renderPanel(makeClient())
    await waitFor(() => {
      expect(screen.getByLabelText('Claude Code 글로벌 경로'))
        .toHaveValue('/home/me/.claude/skills\n/home/me/.claude/agents')
    })
    expect(screen.getByLabelText('OpenCode 글로벌 경로'))
      .toHaveValue('/home/me/.config/opencode/agent')
  })

  it('고쳐서 저장하면 줄 단위로 나눠 보낸다', async () => {
    const setGlobalRoots = vi.fn().mockResolvedValue(DEFAULTS)
    renderPanel(makeClient({ setGlobalRoots }))
    const box = await screen.findByLabelText('Claude Code 글로벌 경로')

    await userEvent.clear(box)
    await userEvent.type(box, '/a{Enter}/b')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))

    expect(setGlobalRoots).toHaveBeenCalledWith({
      claude: ['/a', '/b'],
      opencode: ['/home/me/.config/opencode/agent']
    })
  })

  it('저장에 실패하면 알리고 입력을 지우지 않는다', async () => {
    // 자동 저장이 아니라 사용자가 결과를 보는 자리다. 조용히 넘기지 않는다.
    const setGlobalRoots = vi.fn().mockRejectedValue(new Error('디스크가 가득 찼습니다'))
    renderPanel(makeClient({ setGlobalRoots }))
    const box = await screen.findByLabelText('Claude Code 글로벌 경로')

    await userEvent.clear(box)
    await userEvent.type(box, '/a')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('디스크가 가득 찼습니다')
    expect(box).toHaveValue('/a')
  })

  it('저장하면 돌아온 값으로 다시 채운다', async () => {
    // core가 빈 목록을 기본값으로 되돌리므로, 화면이 그 결과를 반영해야 한다.
    const setGlobalRoots = vi.fn().mockResolvedValue({ claude: ['/정리됨'], opencode: [] })
    renderPanel(makeClient({ setGlobalRoots }))
    const box = await screen.findByLabelText('Claude Code 글로벌 경로')

    await userEvent.clear(box)
    await userEvent.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => expect(box).toHaveValue('/정리됨'))
  })

  it('조회에 실패하면 알린다', async () => {
    renderPanel(makeClient({ globalRoots: vi.fn().mockRejectedValue(new Error('못 읽음')) }))
    expect(await screen.findByRole('alert')).toHaveTextContent('못 읽음')
  })
})
