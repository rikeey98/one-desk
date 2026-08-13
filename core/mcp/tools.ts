import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { RepoRepository } from '../db/repositories/repo'
import type { IssueRepository } from '../db/repositories/issue'
import type { MemoRepository } from '../db/repositories/memo'
import type { RunContext } from './host'

export interface McpHostDeps {
  repos: RepoRepository
  issues: IssueRepository
  memos: MemoRepository
}

/**
 * 이 토큰이 쓸 수 있는 도구만 등록한 서버를 만든다.
 *
 * 필터링을 tools/list 응답에서 하지 않고 **애초에 등록을 안 한다.** 이름을 아는
 * agent가 직접 호출해도 "Tool not found"로 거부된다 (실측 노트 Q28).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Task 2·3이 채울 때까지 두 인자 모두 쓰이지 않는다
export function buildServer(_ctx: RunContext, _deps: McpHostDeps): McpServer {
  const server = new McpServer({ name: 'onedesk', version: '0.1.0' })
  // registerTool을 한 번도 부르지 않으면 McpServer가 tools/list 핸들러 자체를
  // 등록하지 않아 "Method not found"가 난다. 도구가 없어도 빈 목록으로 응답하도록
  // capability와 핸들러를 직접 선언한다 — 도구를 추가하는 게 아니라 프로토콜
  // 핸드셰이크를 완성하는 것이다.
  server.server.registerCapabilities({ tools: {} })
  server.server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [] }))
  return server
}
