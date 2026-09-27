import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClientProvider } from '../client/ClientProvider'
import { AddRepoForm } from './AddRepoForm'
import type { OneDeskClient } from '@shared/client'

function renderForm(pickDirectory: () => Promise<string | null>) {
  const create = vi.fn().mockResolvedValue(undefined)
  const client = {
    repos: { create },
    app: { pickDirectory: vi.fn(pickDirectory) }
  } as unknown as OneDeskClient
  render(
    <ClientProvider client={client}>
      <AddRepoForm workspaceId="w1" onAdded={vi.fn().mockResolvedValue(undefined)} />
    </ClientProvider>
  )
  return { create, client }
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
})
