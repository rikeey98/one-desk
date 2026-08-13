import { describe, it, expect } from 'vitest'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { makeTestDb } from '../db/repositories/testing'
import { createRepoRepository } from '../db/repositories/repo'
import { createIssueRepository } from '../db/repositories/issue'
import { createMemoRepository } from '../db/repositories/memo'
import { createWorkspaceRepository } from '../db/repositories/workspace'
import { buildServer } from './tools'
import type { RunContext } from './host'

function makeCtx(workspaceId: string): RunContext {
  return { runId: 'r1', workspaceId, permission: 'edit' }
}

describe('buildServer', () => {
  it('도구가 없어도 tools/list가 빈 배열로 응답한다', async () => {
    const db = makeTestDb()
    const workspaceId = createWorkspaceRepository(db).create({ name: 'ws' }).id
    const deps = {
      repos: createRepoRepository(db),
      issues: createIssueRepository(db),
      memos: createMemoRepository(db)
    }

    const server = buildServer(makeCtx(workspaceId), deps)
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'test-client', version: '0.0.0' })
    await server.connect(serverTransport)
    await client.connect(clientTransport)

    const res = await client.listTools()
    expect(res.tools).toEqual([])
  })

  it('빈 서버에 실제 도구를 이어서 등록해도 던지지 않고 tools/list에 나타난다', async () => {
    // Task 2·3은 이 함수에 registerTool() 호출을 이어붙인다. buildServer가 빈
    // tools/list를 흉내내려고 SDK 내부 핸들러를 우회해서 설치해 두면, 그 뒤에 오는
    // 진짜 registerTool()이 "핸들러가 이미 있다"며 던진다 — 리뷰에서 지적된 버그.
    const db = makeTestDb()
    const workspaceId = createWorkspaceRepository(db).create({ name: 'ws' }).id
    const deps = {
      repos: createRepoRepository(db),
      issues: createIssueRepository(db),
      memos: createMemoRepository(db)
    }

    const server = buildServer(makeCtx(workspaceId), deps)
    expect(() => {
      server.registerTool(
        'demo_tool',
        { description: '테스트용 실제 도구' },
        async () => ({ content: [{ type: 'text', text: 'ok' }] })
      )
    }).not.toThrow()

    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'test-client', version: '0.0.0' })
    await server.connect(serverTransport)
    await client.connect(clientTransport)

    const res = await client.listTools()
    expect(res.tools.map((t) => t.name)).toEqual(['demo_tool'])
  })
})
