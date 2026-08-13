import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { buildServer, type McpHostDeps } from './tools'
import { clearMcpConfigs, MCP_SERVER_NAME, removeMcpConfig, writeMcpConfig } from './configFile'
import { consoleErrorSink, type ErrorSink } from '../errors'
import type { Permission } from '@shared/models'

// 설정 파일의 mcpServers 키와 --allowedTools의 접두사가 같은 상수를 보도록
// configFile.ts에 정의를 두고 여기서는 re-export만 한다 (host↔tools 순환을
// 피하면서 한 줄로 묶는다).
export { MCP_SERVER_NAME }

export interface RunContext {
  runId: string
  workspaceId: string
  permission: Permission
}

export interface PreparedMcp {
  token: string
  url: string
  configFile: string
}

export interface McpHostOptions {
  deps: McpHostDeps
  /** run별 설정 파일을 둘 디렉토리. Electron의 userData 아래를 main이 넘긴다. */
  configDir: string
  onError?: ErrorSink
}

export function createMcpHost(opts: McpHostOptions) {
  const onError = opts.onError ?? consoleErrorSink
  const tokens = new Map<string, RunContext>()
  let server: Server | null = null
  let starting: Promise<number> | null = null

  // 지난 실행이 남긴 설정 파일을 치운다. 그 토큰들은 이미 죽었지만 파일까지 남길 이유가 없다.
  clearMcpConfigs(opts.configDir)

  /**
   * 서버를 띄운다. **여러 번 불러도 한 번만 뜬다.**
   *
   * 동시에 시작한 두 run이 각자 서버를 띄우면, 한쪽 토큰만 아는 포트가 생겨
   * 절반의 agent가 조용히 연결에 실패한다. 기동 프로미스를 캐시해 두 번째
   * 호출자가 첫 번째 것을 그대로 기다리게 한다.
   */
  function ensureListening(): Promise<number> {
    if (starting) return starting
    starting = new Promise<number>((resolve, reject) => {
      const s = createServer((req, res) => { void handle(req, res) })
      const onStartupError = (err: Error): void => {
        // 실패는 캐시하지 않는다 — 다음 run이 다시 시도할 수 있어야 한다.
        starting = null
        reject(err)
      }
      s.once('error', onStartupError)
      // 포트 0 = OS가 빈 포트를 고른다. 충돌이 원천적으로 불가능하다.
      // 127.0.0.1에만 바인딩하므로 외부 네트워크에서 닿지 않는다.
      s.listen(0, '127.0.0.1', () => {
        // listen이 성공했으니 기동 실패용 리스너는 반드시 떼어낸다. 안 떼면
        // accept 중 EMFILE 같은 사후 오류가 starting을 다시 null로 만들고,
        // 다음 prepare()가 이미 살아 있는 이 서버 위에 두 번째 서버를 새
        // 포트로 띄워 server를 덮어쓴다 — 첫 서버는 닫히지 않고, 이미 돌던
        // run의 설정 파일은 옛 포트를 계속 가리킨다.
        s.off('error', onStartupError)
        s.on('error', (err) => { onError('[mcp] 서버가 기동 후 오류를 냈습니다', err) })
        server = s
        // shutdown()은 동기라 서버가 닫히기를 기다릴 수 없다. unref를 걸어
        // 남은 핸들이 프로세스 종료를 막지 않게 한다.
        s.unref()
        resolve((s.address() as AddressInfo).port)
      })
    })
    return starting
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if ((req.url ?? '').split('?')[0] !== '/mcp') {
        res.writeHead(404).end()
        return
      }

      const auth = req.headers.authorization ?? ''
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
      const ctx = token ? tokens.get(token) : undefined
      if (!ctx) {
        // 없는 토큰인지, 폐기된 토큰인지, 헤더가 빠진 것인지 구분해 알려주지 않는다.
        res.writeHead(401, { 'content-type': 'application/json', 'www-authenticate': 'Bearer' })
        res.end(JSON.stringify({ error: 'unauthorized' }))
        return
      }

      // 요청마다 새로 만든다. 도구 등록은 객체 몇 개를 만드는 일이고,
      // 얻는 것은 "권한이 절대 섞이지 않는다"는 보장이다 (실측 노트 Q28).
      const mcp = buildServer(ctx, opts.deps)
      // stateless — 토큰이 이미 세션 역할을 하므로 세션 id는 중복이다.
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
      res.on('close', () => {
        void transport.close()
        void mcp.close()
      })
      await mcp.connect(transport)
      await transport.handleRequest(req, res)
    } catch (err) {
      onError('[mcp] 요청 처리에 실패했습니다', err)
      // 헤더를 이미 보냈으면 상태 코드를 다시 쓸 수 없다 — 그렇다고 소켓을
      // 열어 둔 채로 두면 클라이언트가 응답을 기다리며 매달린다. 어느
      // 쪽이든 반드시 end()로 닫는다.
      if (!res.headersSent) res.writeHead(500).end()
      else res.end()
    }
  }

  return {
    /**
     * run 하나가 쓸 토큰과 설정 파일을 준비한다.
     *
     * 서버 기동을 여기서 await한다 — 앱을 여는 것만으로는 포트가 열리지 않는다.
     */
    async prepare(ctx: RunContext): Promise<PreparedMcp> {
      const port = await ensureListening()
      // 32바이트 = 256비트. 무차별 대입이 불가능하다.
      const token = randomBytes(32).toString('base64url')
      tokens.set(token, ctx)
      const url = `http://127.0.0.1:${port}/mcp`
      return { token, url, configFile: writeMcpConfig(opts.configDir, ctx.runId, url, token) }
    },

    /**
     * 토큰을 폐기하고 설정 파일을 지운다.
     *
     * **prepare()로 토큰을 받은 run을 포기하는 모든 자리에서 부른다.** "슬롯을
     * 돌려주는 모든 자리"가 아니다 — `execution.ts`의 `cancel()`이 대기 중인
     * run을 취소하는 분기처럼, 슬롯을 쥔 적이 없어도 토큰은 이미 쥐고 있을 수
     * 있는 자리가 있다(자세한 사정은 `core/execution.ts`의 releaseMcp 주석).
     * 한 자리라도 빠지면 끝난(혹은 시작도 못한) run의 토큰으로 workspace를
     * 계속 읽고 쓸 수 있다.
     */
    release(runId: string): void {
      for (const [token, ctx] of tokens) {
        if (ctx.runId === runId) tokens.delete(token)
      }
      removeMcpConfig(opts.configDir, runId)
    },

    close(): void {
      tokens.clear()
      // keep-alive 연결이 남아 있으면 close()가 오래 걸린다. 먼저 끊는다.
      server?.closeAllConnections()
      server?.close()
      server = null
      starting = null
      clearMcpConfigs(opts.configDir)
    },

    /** 테스트용. 아직 안 떴으면 null. */
    port(): number | null {
      return server ? (server.address() as AddressInfo).port : null
    }
  }
}

export type McpHost = ReturnType<typeof createMcpHost>
export type { McpHostDeps }
