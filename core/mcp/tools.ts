import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
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
  // registerTool을 한 번도 부르지 않으면 McpServer가 tools/list·tools/call 핸들러
  // 자체를 절대 설치하지 않아 "Method not found"가 난다. 그렇다고 server.server에
  // 직접 setRequestHandler를 걸어 우회하면 McpServer의 _toolHandlersInitialized
  // 플래그가 켜지지 않은 채로 남는다 — Task 2·3이 이 함수에 registerTool()을
  // 이어붙이는 순간 SDK가 "핸들러가 이미 있다"며 던진다(코드 리뷰에서 지적, 실측
  // 확인됨: registerTool()이 그때 assertCanSetRequestHandler를 다시 통과하며
  // 우리가 심어둔 핸들러와 충돌한다).
  //
  // 정공법은 공개 API로 placeholder 도구를 등록했다가 바로 지우는 것이다.
  // registerTool()이 내부적으로 _toolHandlersInitialized를 정식 경로로 켜므로,
  // 이후 Task 2·3이 진짜 도구를 몇 개(0개 포함 — read_only 권한처럼 일부만
  // 등록되는 경우도) 등록하든 그 경로를 다시 타지 않는다. list/call 핸들러는 매
  // 요청마다 내부 레지스트리를 그대로 읽으므로 placeholder를 지운 뒤엔 자연스럽게
  // 빈 목록으로 응답한다.
  const bootstrap = server.registerTool(
    '__onedesk_bootstrap',
    { description: '내부용 — tools/list 핸들러를 초기화하기 위한 자리표시자. 응답에 남지 않는다.' },
    async () => ({ content: [] })
  )
  bootstrap.remove()
  return server
}
