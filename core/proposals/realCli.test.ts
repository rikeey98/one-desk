/**
 * 진짜 claude가 읽기 전용에서 `propose_issue`를 부르는가, 그리고 안내의 문턱이 지켜지는가 (`docs/sdlc/agent-proposals/` plan 10단계).
 * **기본적으로 건너뛴다** — `ONE_DESK_REAL_CLI=1 pnpm test core/proposals/realCli`. 로그인한 claude가 있어야 하고 실제 모델을 열세 번
 * 부른다. 측정(일 지시·질문 지시 각각 몇 번 제안했나)은 게이트가 아니다 — `ONE_DESK_REAL_PROPOSAL_OUT`에 표로 남긴다.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { makeTestDb } from '../db/repositories/testing'
import { createRepoRepository } from '../db/repositories/repo'
import { createIssueRepository } from '../db/repositories/issue'
import { createMemoRepository } from '../db/repositories/memo'
import { createRunRepository } from '../db/repositories/run'
import { createWorkspaceRepository } from '../db/repositories/workspace'
import { createProposalRepository } from '../db/repositories/proposal'
import { claudeCodeAdapter } from '../runner/adapters/claudeCode'
import { assemblePrompt } from '../context/assemble'
import { HOST_ENV } from '../wsl/env'
import { createMcpHost, MCP_SERVER_NAME, type McpHost } from '../mcp/host'

const ENABLED = process.env['ONE_DESK_REAL_CLI'] === '1'

const TASKS = [
  '로그인 버튼이 모바일에서 안 눌려, 고쳐줘',
  '설정 화면에 다크 모드 토글을 추가해줘',
  'README의 설치 절차가 낡았어, 최신으로 고쳐줘'
]
const QUESTIONS = [
  '이 함수 뭐 하는 거야? function add(a, b) { return a + b }',
  'TypeScript에서 interface와 type의 차이가 뭐야?',
  '안녕, 오늘 기분 어때?'
]

let host: McpHost
let dir: string
let workspaceId: string
let db: ReturnType<typeof makeTestDb>
let repo: ReturnType<ReturnType<typeof createRepoRepository>['create']>

beforeEach(async () => {
  db = makeTestDb()
  workspaceId = createWorkspaceRepository(db).create({ name: 'ws' }).id
  dir = mkdtempSync(resolve(tmpdir(), 'one-desk-realprop-'))
  // 일 지시가 가리키는 작은 repo — 빈 폴더면 모델이 고칠 것을 못 찾아 [NEEDS_ANSWER]로 끝나 제안까지 가지 않는다(첫 측정)
  mkdirSync(resolve(dir, 'src'))
  writeFileSync(resolve(dir, 'src/login.html'), [
    '<style>.overlay { position: fixed; inset: 0; z-index: 10; } .login { z-index: 1; }</style>',
    '<div class="overlay" aria-hidden="true"></div>',
    '<button class="login" onclick="login()">로그인</button>'
  ].join('\n'))
  writeFileSync(resolve(dir, 'src/Settings.tsx'), 'export function Settings() {\n  return <section><h1>설정</h1></section>\n}\n')
  writeFileSync(resolve(dir, 'README.md'), '# web\n\n## 설치\n\nnpm install -g bower\nbower install\n')
  repo = createRepoRepository(db).create({ workspaceId, name: 'web', path: dir })
  host = createMcpHost({
    deps: {
      repos: createRepoRepository(db), issues: createIssueRepository(db), memos: createMemoRepository(db),
      runs: createRunRepository(db), proposals: createProposalRepository(db, () => {})
    },
    configDir: resolve(dir, 'mcp'),
    execPath: process.execPath,
    execEnv: {},
    bridgePath: fileURLToPath(new URL('../mcp/bridge.mjs', import.meta.url))
  })
  await host.start()
})

afterEach(() => {
  host.close()
  rmSync(dir, { recursive: true, force: true })
})

/** 이슈 없는 새 대화의 첫 턴 하나를 읽기 전용으로 돌린다. 돌려주는 것: init의 도구 목록과 그 대화에 선 제안 수 */
async function turn(userPrompt: string): Promise<{ tools: string[]; proposals: number }> {
  const root = createRunRepository(db).create({
    workspaceId, agentKind: 'claude-code', model: null, effort: null, cwd: dir, permission: 'read_only',
    userPrompt, assembledPrompt: '', logPath: resolve(dir, 'x'), context: []
  })
  const p = await host.prepare({
    runId: root.id, rootRunId: root.id, workspaceId, permission: 'read_only', agentKind: 'claude-code', env: HOST_ENV
  })
  const prompt = assemblePrompt({ repos: [repo], issues: [], memos: [], assets: [], userPrompt, proposeIssue: true })
  const { args } = claudeCodeAdapter.buildCommand({
    runId: root.id, cwd: dir, model: null, effort: null, permission: 'read_only', prompt, resumeSessionId: null,
    executable: 'claude', mcp: { serverName: MCP_SERVER_NAME, configFile: p.configFile, token: p.token, url: p.url }
  })
  // **동기 spawn을 쓰면 안 된다** — 같은 프로세스의 MCP 서버가 연결을 받지 못한다(CLAUDE.md의 execFileSync 함정)
  const out = await new Promise<string>((done) => {
    const child = spawn('claude', args, { cwd: dir })
    let acc = ''
    child.stdout.on('data', (c: Buffer) => { acc += c.toString('utf8') })
    child.stdin.write(prompt)
    child.stdin.end()
    child.on('close', () => done(acc))
  })
  host.release(root.id)
  const dump = process.env['ONE_DESK_REAL_PROPOSAL_DUMP']
  if (dump) writeFileSync(resolve(dump, `${root.id}.jsonl`), out)
  const init = out.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) as Record<string, unknown> } catch { return {} } })
    .find((o) => o['type'] === 'system' && o['subtype'] === 'init')
  const state = createProposalRepository(db, () => {}).stateOf(root.id)
  return { tools: (init?.['tools'] as string[] | undefined) ?? [], proposals: state.pending ? 1 : 0 }
}

describe.skipIf(!ENABLED)('진짜 claude — propose_issue', () => {
  it('읽기 전용에서도 도구가 보이고, 일 지시에 제안한다 — 일·질문 지시를 두 번씩 잰다', async () => {
    const rows: string[] = ['kind\tprompt\ttry\tproposed']
    const only = process.env['ONE_DESK_REAL_PROPOSAL_ONLY']
    const tally = { task: 0, question: 0 }
    let firstTools: string[] | null = null
    for (const [kind, list] of [['task', TASKS], ['question', QUESTIONS]] as const) {
      for (const text of only ? list.filter((t) => t.includes(only)) : list) {
        for (const attempt of [1, 2]) {
          const r = await turn(text)
          firstTools ??= r.tools
          tally[kind] += r.proposals
          rows.push(`${kind}\t${text}\t${attempt}\t${r.proposals}`)
        }
      }
    }
    rows.push(`# task ${tally.task}/6, question ${tally.question}/6`)
    const outFile = process.env['ONE_DESK_REAL_PROPOSAL_OUT']
    if (outFile) writeFileSync(outFile, rows.join('\n') + '\n')
    expect(firstTools).toContain(`mcp__${MCP_SERVER_NAME}__propose_issue`)
    expect(firstTools).not.toContain(`mcp__${MCP_SERVER_NAME}__create_issue`)
    expect(tally.task).toBeGreaterThan(0)
  }, 1_800_000)
})
