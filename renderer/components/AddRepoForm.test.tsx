import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClientProvider } from '../client/ClientProvider'
import { AddRepoForm } from './AddRepoForm'
import type { OneDeskClient } from '@shared/client'
import type { WslDistros } from '@shared/models'

const NO_WSL: WslDistros = { supported: false, distros: [], defaultDistro: null, reason: 'WSL은 Windows에서만 쓸 수 있습니다' }
const WSL: WslDistros = { supported: true, distros: ['docker-desktop', 'Ubuntu-24.04'], defaultDistro: 'Ubuntu-24.04', reason: null }
const UNC = '\\\\wsl.localhost\\Ubuntu-24.04\\home\\me\\api'

function renderForm(
  pickDirectory: () => Promise<string | null>,
  listDistros: () => Promise<WslDistros> = async () => NO_WSL
) {
  const create = vi.fn().mockResolvedValue(undefined)
  const onAdded = vi.fn().mockResolvedValue(undefined)
  const client = {
    repos: { create },
    app: { pickDirectory: vi.fn(pickDirectory) },
    wsl: { listDistros: vi.fn(listDistros) }
  } as unknown as OneDeskClient
  render(
    <ClientProvider client={client}>
      <AddRepoForm workspaceId="w1" onAdded={onAdded} />
    </ClientProvider>
  )
  return { create, client, onAdded }
}

/** 경로 칸에 친다 — 역슬래시가 든 UNC도 글자 그대로 */
async function typePath(text: string) {
  const input = screen.getByPlaceholderText('/절대/경로')
  await userEvent.clear(input)
  await userEvent.click(input)
  await userEvent.paste(text)
}

describe('AddRepoForm 폴더 선택', () => {
  it('고른 폴더가 경로에 들어가고, 비어 있던 이름은 폴더 이름으로 채워진다', async () => {
    const { create } = renderForm(async () => 'C:\\work\\api-server')
    await userEvent.click(screen.getByRole('button', { name: '폴더 선택' }))
    await waitFor(() => expect(screen.getByPlaceholderText('/절대/경로')).toHaveValue('C:\\work\\api-server'))
    expect(screen.getByPlaceholderText('repo 이름')).toHaveValue('api-server')
    await userEvent.click(screen.getByRole('button', { name: '추가' }))
    await waitFor(() => expect(create).toHaveBeenCalledWith({ workspaceId: 'w1', name: 'api-server', path: 'C:\\work\\api-server' }))
  })

  it('이미 적어 둔 이름은 덮어쓰지 않는다', async () => {
    renderForm(async () => '/tmp/web/')
    await userEvent.type(screen.getByPlaceholderText('repo 이름'), '프론트')
    await userEvent.click(screen.getByRole('button', { name: '폴더 선택' }))
    await waitFor(() => expect(screen.getByPlaceholderText('/절대/경로')).toHaveValue('/tmp/web/'))
    expect(screen.getByPlaceholderText('repo 이름')).toHaveValue('프론트')
  })

  it('대화상자를 취소하면 아무것도 바꾸지 않는다', async () => {
    const { client } = renderForm(async () => null)
    await userEvent.type(screen.getByPlaceholderText('/절대/경로'), '/tmp/keep')
    await userEvent.click(screen.getByRole('button', { name: '폴더 선택' }))
    await waitFor(() => expect(client.app.pickDirectory).toHaveBeenCalled())
    expect(screen.getByPlaceholderText('/절대/경로')).toHaveValue('/tmp/keep')
    expect(screen.getByPlaceholderText('repo 이름')).toHaveValue('')
  })

  it('대화상자를 못 열면 오류를 보여준다', async () => {
    renderForm(async () => { throw new Error('창이 없습니다') })
    await userEvent.click(screen.getByRole('button', { name: '폴더 선택' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('창이 없습니다')
  })

  it('폴더 선택은 시작 인자를 넘기지 않는다 — OS 기본 위치에서 연다', async () => {
    const { client } = renderForm(async () => null, async () => WSL)
    await userEvent.click(screen.getByRole('button', { name: '폴더 선택' }))
    await waitFor(() => expect(client.app.pickDirectory).toHaveBeenCalledWith())
  })
})

describe('AddRepoForm — WSL (docs/sdlc/wsl-repo-setup/)', () => {
  it('WSL을 쓸 수 없으면 WSL 버튼도 체크도 없다 — WSL 경로를 쳐도 host로 보낸다 (FR-1·5)', async () => {
    const { create, client } = renderForm(async () => null)
    await waitFor(() => expect(client.wsl.listDistros).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'WSL 폴더 고르기' })).toBeNull()
    await userEvent.type(screen.getByPlaceholderText('repo 이름'), 'api')
    await typePath(UNC)
    expect(screen.queryByRole('checkbox')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: '추가' }))
    await waitFor(() => expect(create).toHaveBeenCalledWith({ workspaceId: 'w1', name: 'api', path: UNC }))
  })

  it('배포판 목록을 못 얻어도 폼은 돈다 — WSL 버튼만 없다 (FR-1)', async () => {
    const { create, client } = renderForm(async () => null, async () => { throw new Error('IPC 끊김') })
    await waitFor(() => expect(client.wsl.listDistros).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'WSL 폴더 고르기' })).toBeNull()
    await userEvent.type(screen.getByPlaceholderText('repo 이름'), 'web')
    await typePath('/srv/web')
    await userEvent.click(screen.getByRole('button', { name: '추가' }))
    await waitFor(() => expect(create).toHaveBeenCalledWith({ workspaceId: 'w1', name: 'web', path: '/srv/web' }))
  })

  it('배포판이 있으면 WSL 버튼이 서고, 풍선이 어느 배포판의 홈에서 여는지 말한다 (FR-1)', async () => {
    renderForm(async () => null, async () => WSL)
    const button = await screen.findByRole('button', { name: 'WSL 폴더 고르기' })
    expect(button).toHaveTextContent('WSL')
    expect(button).toHaveAttribute('title', 'WSL 폴더 고르기 — Ubuntu-24.04의 홈에서 엽니다')
  })

  it('WSL 버튼은 뜻만 넘기고, 고른 WSL 폴더는 체크가 켜진 채 WSL repo로 등록된다 (FR-2·3·5)', async () => {
    const { create, client, onAdded } = renderForm(async () => UNC, async () => WSL)
    await userEvent.click(await screen.findByRole('button', { name: 'WSL 폴더 고르기' }))
    expect(client.app.pickDirectory).toHaveBeenCalledWith({ start: 'wsl' })
    await waitFor(() => expect(screen.getByPlaceholderText('/절대/경로')).toHaveValue(UNC))
    expect(screen.getByPlaceholderText('repo 이름')).toHaveValue('api')
    const check = screen.getByRole('checkbox', { name: 'WSL 안의 claude로 실행' })
    expect(check).toBeChecked()
    // 배포판과 Linux 경로가 두 줄이다 — 설명은 둘을 잇는다
    expect(check).toHaveAccessibleDescription('Ubuntu-24.04 /home/me/api')

    await userEvent.click(screen.getByRole('button', { name: '추가' }))
    await waitFor(() => expect(create).toHaveBeenCalledWith({ workspaceId: 'w1', name: 'api', path: UNC, agentEnv: 'wsl' }))
    await waitFor(() => expect(onAdded).toHaveBeenCalled())
    // 등록이 끝나면 처음으로 — 경로가 비었으니 체크도 없다
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('WSL 경로를 직접 붙여 넣어도 체크가 켜진 채 선다 (FR-3)', async () => {
    renderForm(async () => null, async () => WSL)
    await screen.findByRole('button', { name: 'WSL 폴더 고르기' })
    await typePath('\\\\wsl$\\Ubuntu-24.04\\srv\\x')
    expect(screen.getByRole('checkbox', { name: 'WSL 안의 claude로 실행' })).toBeChecked()
  })

  it('끄면 host로 보내고, 경로를 고쳐도 다시 켜지지 않는다 (FR-4·5)', async () => {
    const { create } = renderForm(async () => null, async () => WSL)
    await screen.findByRole('button', { name: 'WSL 폴더 고르기' })
    await userEvent.type(screen.getByPlaceholderText('repo 이름'), 'api')
    await typePath(UNC)
    const check = screen.getByRole('checkbox', { name: 'WSL 안의 claude로 실행' })
    await userEvent.click(check)
    expect(check).not.toBeChecked()
    expect(check).toHaveAccessibleDescription('Windows의 claude가 이 폴더를 다룹니다')
    await userEvent.type(screen.getByPlaceholderText('/절대/경로'), '2')
    expect(screen.getByRole('checkbox', { name: 'WSL 안의 claude로 실행' })).not.toBeChecked()

    await userEvent.click(screen.getByRole('button', { name: '추가' }))
    await waitFor(() => expect(create).toHaveBeenCalledWith({ workspaceId: 'w1', name: 'api', path: `${UNC}2` }))
  })

  it('WSL 경로가 아니게 되면 끈 것을 잊는다 — 다음 WSL 경로는 다시 켜진 채 온다 (FR-4)', async () => {
    renderForm(async () => null, async () => WSL)
    await screen.findByRole('button', { name: 'WSL 폴더 고르기' })
    await typePath(UNC)
    await userEvent.click(screen.getByRole('checkbox', { name: 'WSL 안의 claude로 실행' }))
    await typePath('D:\\work\\api')
    expect(screen.queryByRole('checkbox')).toBeNull()
    await typePath(UNC)
    expect(screen.getByRole('checkbox', { name: 'WSL 안의 claude로 실행' })).toBeChecked()
  })

  it('대화상자가 새 경로를 넣으면 끈 것을 잊는다 (FR-4)', async () => {
    renderForm(async () => '\\\\wsl.localhost\\Ubuntu-24.04\\home\\me\\web', async () => WSL)
    await screen.findByRole('button', { name: 'WSL 폴더 고르기' })
    await typePath(UNC)
    await userEvent.click(screen.getByRole('checkbox', { name: 'WSL 안의 claude로 실행' }))
    await userEvent.click(screen.getByRole('button', { name: 'WSL 폴더 고르기' }))
    await waitFor(() => expect(screen.getByPlaceholderText('/절대/경로')).toHaveValue('\\\\wsl.localhost\\Ubuntu-24.04\\home\\me\\web'))
    expect(screen.getByRole('checkbox', { name: 'WSL 안의 claude로 실행' })).toBeChecked()
  })

  it('목록에 없는 배포판이면 경고하되 등록은 막지 않는다 (FR-3)', async () => {
    const { create } = renderForm(async () => null, async () => WSL)
    await screen.findByRole('button', { name: 'WSL 폴더 고르기' })
    await userEvent.type(screen.getByPlaceholderText('repo 이름'), 'arch')
    await typePath('\\\\wsl$\\Arch\\home\\me')
    expect(screen.getByText(/이 배포판이 wsl --list에 없습니다/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '추가' }))
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ agentEnv: 'wsl' })))
  })
})
