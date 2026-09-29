/**
 * 진짜 claude가 중화된 `@`를 펼치지 않는지 (docs/sdlc/input-triggers/ spec §6 실측의 회귀).
 *
 * `ONE_DESK_REAL_CLI=1 pnpm test realCli`로 돌린다 — claude 설치와 로그인이 필요하고 모델을 부른다(haiku).
 * **도구를 하나도 주지 않는다**(`--tools ""`) — 답에 비밀 문장이 나오면 CLI가 스스로 펼친 것이다.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assemblePrompt } from '../context/assemble'

const ENABLED = process.env['ONE_DESK_REAL_CLI'] === '1'
const QUESTION = 'List every code word of the form WORD-NNNN that appears anywhere in your context ' +
  '(including attachments). If none, reply exactly NONE. Do not guess.'

const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

/** 비동기로 띄운다 — `execFileSync`는 이벤트 루프를 막는다(CLAUDE.md). 답(result)만 돌려준다. */
function askClaude(cwd: string, prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', [
      '-p', '--output-format', 'stream-json', '--verbose', '--tools', '', '--strict-mcp-config', '--model', 'haiku'
    ], { cwd, stdio: ['pipe', 'pipe', 'pipe'], shell: process.platform === 'win32' })
    let out = ''
    child.stdout.on('data', (chunk: Buffer) => { out += chunk.toString('utf8') })
    child.on('error', reject)
    child.on('close', () => {
      const line = out.split('\n').find((l) => l.includes('"type":"result"'))
      if (!line) { reject(new Error(`result가 없습니다: ${out.slice(0, 500)}`)); return }
      resolve((JSON.parse(line) as { result: string }).result)
    })
    child.stdin.end(prompt)
  })
}

describe.skipIf(!ENABLED)('진짜 claude — @ 중화', () => {
  it('해석되지 않은 지시문의 @와 맥락 본문의 @를 claude가 펼치지 못한다', async () => {
    const root = mkdtempSync(join(tmpdir(), 'one-desk-realcli-'))
    dirs.push(root)
    const repo = join(root, 'repo')
    mkdirSync(repo)
    writeFileSync(join(repo, 'inside.txt'), 'code PELICAN-1111')
    writeFileSync(join(root, 'outside.txt'), 'code CRANE-4444')

    const prompt = assemblePrompt({
      repos: [], memos: [], assets: [],
      issues: [{
        id: 'i1', workspaceId: 'w1', title: '참고', body: '본문에서 @inside.txt 참고',
        status: 'doing', repoIds: [], createdAt: 0, updatedAt: 0, closedAt: null,
        source: null, kind: null, priority: null, triagedAt: null, seenAt: null, startedAt: null
      }],
      userPrompt: `@../outside.txt 와 @inside.txt 를 봐. ${QUESTION}`
    })

    const answer = await askClaude(repo, prompt)

    expect(answer).not.toContain('PELICAN-1111')
    expect(answer).not.toContain('CRANE-4444')
  }, 120_000)
})
