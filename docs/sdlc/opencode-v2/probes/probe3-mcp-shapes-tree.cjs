// opencode 2.x 실측 3차: MCP·action 이름·도구 결과 모양·생각 줄·프로세스 트리·variant·2.0.18.
// 사용: node probe3.cjs <opencode.exe> <작업 폴더> <mcp-ping.cjs> [<2.0.18 cli>]
const { spawn, execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const [exe, root, mcpServer, oldCli] = process.argv.slice(2)
const MODEL = 'opencode/big-pickle'
const MCP = { servers: { onedesk: { type: 'local', command: [process.execPath, mcpServer] } } }
const ALL = 'Do every step below with tools, one tool call per step, continuing even if a step fails. Then reply DONE. ' +
  '1) Call the ping tool from the onedesk MCP server. 2) Read the file a.txt. 3) Search file contents for the text hello (grep tool). ' +
  '4) Find files matching *.txt (glob tool). 5) Edit a.txt replacing hello with bye. 6) Create b.txt containing hi. ' +
  '7) Run the shell command: echo SHELL-OK 8) Run the shell command: exit 3'

function prep(name) {
  const dir = path.join(root, name)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  execFileSync('git', ['init', '-q'], { cwd: dir })
  fs.writeFileSync(path.join(dir, 'a.txt'), 'line one\nhello world\nline three\n')
  return dir
}

const content = (permissions, withMcp = true) => ({
  OPENCODE_CONFIG_CONTENT: JSON.stringify({ permissions, ...(withMcp ? { mcp: MCP } : {}) })
})

function start(bin, name, dir, args, env, stdin) {
  const child = spawn(bin, ['run', '--standalone', '--format', 'json', ...args], {
    cwd: dir, env: { ...process.env, ...env }, windowsHide: true
  })
  let out = ''
  let err = ''
  child.stdout.on('data', (d) => { out += d })
  child.stderr.on('data', (d) => { err += d })
  if (stdin) child.stdin.write(stdin)
  child.stdin.end()
  const timer = setTimeout(() => kill(child.pid), 150_000)
  const done = new Promise((resolve) => child.on('close', (code) => {
    clearTimeout(timer)
    fs.writeFileSync(path.join(root, `${name}.jsonl`), out)
    fs.writeFileSync(path.join(root, `${name}.err`), err)
    const lines = out.split(/\r?\n/).flatMap((l) => { try { return [JSON.parse(l)] } catch { return [] } })
    resolve({ code, lines, err: err.replace(/\x1b\[[0-9;]*m/g, '').trim() })
  }))
  return { child, done }
}

function kill(pid) {
  try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* 이미 끝남 */ }
}

const toolsOf = (lines) => lines.filter((o) => o.type === 'tool_use').map((o) => {
  const st = o.part?.state ?? {}
  return `${o.part?.tool}:${st.status}${st.error ? ` (${String(st.error).slice(0, 120)})` : ''}`
})
const lastText = (lines) => lines.filter((o) => o.type === 'text').map((o) => String(o.part?.text).slice(0, 160)).at(-1) ?? null
const errorsOf = (lines) => lines.filter((o) => o.type === 'error').map((o) => JSON.stringify(o.error).slice(0, 240))

/** pid의 자손 전부 (이름 포함) */
function descendants(pid) {
  const raw = execFileSync('powershell', ['-NoProfile', '-Command',
    'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress'], { encoding: 'utf8', maxBuffer: 64e6 })
  const all = JSON.parse(raw)
  const found = []
  const walk = (p) => { for (const x of all) if (x.ParentProcessId === p) { found.push(`${x.Name}(${x.ProcessId})`); walk(x.ProcessId) } }
  walk(pid)
  return found
}
const alive = (label) => { const m = /\((\d+)\)/.exec(label); try { process.kill(Number(m[1]), 0); return true } catch { return false } }

async function main() {
  const report = {}

  // A. 전부 ask — stderr의 "permission requested: <action> (<resource>)"로 action 이름을 얻는다
  const a = start(exe, 'ask-all', prep('ask-all'), ['-m', MODEL, ALL], content([{ action: '*', resource: '*', effect: 'ask' }]))
  // B. 전부 allow + --thinking — 도구 결과 모양
  const b = start(exe, 'shapes', prep('shapes'), ['-m', MODEL, '--thinking', ALL], content([{ action: '*', resource: '*', effect: 'allow' }]))
  // D. variant
  const d = start(exe, 'variant', prep('variant'), ['-m', `${MODEL}#high`, 'Reply with only OK.'], {})
  // C. 프로세스 트리와 취소
  const c = start(exe, 'tree', prep('tree'), ['-m', MODEL, 'Run this shell command and wait for it to finish, then reply DONE: ping -n 60 127.0.0.1'],
    content([{ action: '*', resource: '*', effect: 'allow' }], false))
  const tree = (async () => {
    let seen = []
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 4000))
      seen = descendants(c.child.pid)
      if (seen.some((s) => /^PING/i.test(s))) break
    }
    kill(c.child.pid)
    await new Promise((r) => setTimeout(r, 2500))
    return { rootPid: c.child.pid, descendantsBeforeKill: seen, stillAliveAfterKill: seen.filter(alive) }
  })()

  const ra = await a.done
  report.askAll = {
    exit: ra.code, tools: toolsOf(ra.lines),
    requested: ra.err.split(/\r?\n/).filter((l) => l.includes('permission requested'))
  }
  const rb = await b.done
  report.shapes = {
    exit: rb.code, types: [...new Set(rb.lines.map((o) => o.type))], tools: toolsOf(rb.lines), lastText: lastText(rb.lines),
    reasoning: rb.lines.filter((o) => o.type === 'reasoning').slice(0, 1).map((o) => ({ partKeys: Object.keys(o.part ?? {}), text: String(o.part?.text).slice(0, 80), time: o.part?.time })),
    detail: rb.lines.filter((o) => o.type === 'tool_use').map((o) => {
      const st = o.part?.state ?? {}
      return {
        tool: o.part?.tool, partKeys: Object.keys(o.part ?? {}), stateKeys: Object.keys(st), status: st.status,
        input: JSON.stringify(st.input).slice(0, 200), metadata: JSON.stringify(st.metadata)?.slice(0, 700),
        output: typeof st.output === 'string' ? st.output.slice(0, 160) : st.output, error: st.error ? String(st.error).slice(0, 200) : undefined
      }
    }),
    stepFinish: rb.lines.filter((o) => o.type === 'step_finish').slice(-1).map((o) => o.part)
  }
  const rd = await d.done
  report.variant = { exit: rd.code, lastText: lastText(rd.lines), errors: errorsOf(rd.lines), stderr: rd.err.slice(0, 300) }
  report.tree = await tree
  await c.done

  // E. 읽기 전용 + MCP만 — A에서 본 MCP action으로 연다
  const mcpAction = (report.askAll.requested.map((l) => /permission requested: (\S+)/.exec(l)?.[1]).find((x) => x && /ping|onedesk|mcp/i.test(x))) ?? 'onedesk_ping'
  const readOnly = [{ action: '*', resource: '*', effect: 'deny' }, ...['read', 'grep', 'glob'].map((action) => ({ action, resource: '*', effect: 'allow' }))]
  const e1 = start(exe, 'ro-mcp', prep('ro-mcp'), ['-m', MODEL, ALL], content([...readOnly, { action: mcpAction, resource: '*', effect: 'allow' }]))
  // 와일드카드 action이 되는가
  const e2 = start(exe, 'ro-mcp-wild', prep('ro-mcp-wild'), ['-m', MODEL, ALL], content([...readOnly, { action: 'onedesk_*', resource: '*', effect: 'allow' }]))
  // 편집 허용: 쓰기 action만 더
  const e3 = start(exe, 'edit-level', prep('edit-level'), ['-m', MODEL, ALL], content([...readOnly, { action: 'edit', resource: '*', effect: 'allow' }]))
  for (const [k, r, dir] of [['roMcp', await e1.done, 'ro-mcp'], ['roMcpWild', await e2.done, 'ro-mcp-wild'], ['editLevel', await e3.done, 'edit-level']]) {
    report[k] = {
      exit: r.code, mcpAction: k === 'roMcp' ? mcpAction : undefined, tools: toolsOf(r.lines), lastText: lastText(r.lines),
      aTxt: fs.readFileSync(path.join(root, dir, 'a.txt'), 'utf8').includes('bye') ? 'edited' : 'untouched',
      bTxt: fs.existsSync(path.join(root, dir, 'b.txt')), stderr: r.err.slice(0, 300)
    }
  }

  // F. 2.0.18 번들 CLI — 같은 통로가 있는가
  if (oldCli) {
    const dir = prep('old-cli')
    const f = start(oldCli, 'old-cli', dir, ['-m', MODEL, ALL], content([{ action: '*', resource: '*', effect: 'deny' }, { action: 'read', resource: '*', effect: 'allow' }], false))
    const rf = await f.done
    report.oldCli = {
      exit: rf.code, tools: toolsOf(rf.lines), lastText: lastText(rf.lines), errors: errorsOf(rf.lines),
      aTxt: fs.readFileSync(path.join(dir, 'a.txt'), 'utf8').includes('bye') ? 'edited' : 'untouched',
      bTxt: fs.existsSync(path.join(dir, 'b.txt')), stderr: rf.err.slice(0, 500)
    }
  }

  fs.writeFileSync(path.join(root, 'report.json'), JSON.stringify(report, null, 1))
  console.log(JSON.stringify(report, null, 1))
}

main()
