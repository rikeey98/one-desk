// opencode 2.x 실측 8차 (plan 0단계): MCP 설정 파일·서버 이름의 하이픈·세션 확인·서비스·도구 목록·skill.
// 사용: node probe8.cjs <opencode.exe> <작업 폴더> <mcp-ping.cjs>
const { spawn, execFileSync, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const [exe, root, mcpServer] = process.argv.slice(2)
const MODEL = 'opencode/big-pickle'
const SERVER = 'one-desk'
const base = path.basename(exe).toLowerCase()

const RO = (extra = []) => [{ action: '*', resource: '*', effect: 'deny' }, ...['read', 'grep', 'glob'].map((action) => ({ action, resource: '*', effect: 'allow' })), ...extra]
const both = (permissions) => ({ permissions, agents: { build: { permissions } } })

function prep(name) {
  const dir = path.join(root, name)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  execFileSync('git', ['init', '-q'], { cwd: dir })
  return dir
}

function kill(pid) {
  try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* 끝남 */ }
}

function run(name, dir, args, env, prompt) {
  return new Promise((resolve) => {
    const child = spawn(exe, ['run', '--standalone', '--format', 'json', '--agent', 'build', '-m', MODEL, ...args], {
      cwd: dir, env: { ...process.env, ...env }, windowsHide: true
    })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { err += d })
    child.stdin.write(prompt)
    child.stdin.end()
    const timer = setTimeout(() => kill(child.pid), 120_000)
    child.on('close', (code) => {
      clearTimeout(timer)
      fs.writeFileSync(path.join(root, `${name}.jsonl`), out)
      const tools = []
      let text = null
      let session = null
      for (const line of out.split(/\r?\n/)) {
        let o
        try { o = JSON.parse(line) } catch { continue }
        session = o.sessionID ?? session
        if (o.type === 'tool_use') tools.push(`${o.part?.tool}:${o.part?.state?.status}`)
        if (o.type === 'text') text = String(o.part?.text).slice(0, 700)
        if (o.type === 'error') text = `ERROR ${JSON.stringify(o.error).slice(0, 200)}`
      }
      resolve({ exit: code, tools, text, session, stderr: err.replace(/\x1b\[[0-9;]*m/g, '').trim().slice(0, 300) })
    })
  })
}

const procs = () => {
  const out = execFileSync('tasklist', ['/FI', `IMAGENAME eq ${base}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' })
  return out.split(/\r?\n/).filter((l) => l.toLowerCase().includes(base)).length
}

function quick(args, cwd, env = {}) {
  const started = Date.now()
  const r = spawnSync(exe, args, { cwd, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 30_000, input: '' })
  return { args: args.join(' '), exit: r.status, ms: Date.now() - started, out: String(r.stdout).trim().slice(0, 220), err: String(r.stderr).replace(/\x1b\[[0-9;]*m/g, '').trim().slice(0, 160) }
}

async function main() {
  const report = {}

  // 4. 어느 명령이 백그라운드 서비스를 띄우는가 (모델 없음). 먼저 깨끗한지 본다.
  const dir0 = prep('service')
  spawnSync(exe, ['service', 'stop'], { cwd: dir0, encoding: 'utf8', timeout: 30_000 })
  report.service = { before: procs(), steps: [] }
  for (const args of [['--version'], ['models', '--standalone'], ['models'], ['auth', 'list', '--standalone'], ['auth', 'list'], ['debug', 'config', '--standalone'], ['debug', 'config']]) {
    const r = quick(args, dir0)
    await new Promise((res) => setTimeout(res, 1500))
    const after = procs()
    report.service.steps.push({ args: r.args, exit: r.exit, ms: r.ms, procsAfter: after, head: (r.out || r.err).split(/\r?\n/)[0].slice(0, 90) })
    if (after > 0) { spawnSync(exe, ['service', 'stop'], { cwd: dir0, encoding: 'utf8', timeout: 30_000 }); await new Promise((res) => setTimeout(res, 1500)) }
  }

  // 1. OPENCODE_CONFIG 파일의 mcp.servers + 하이픈 든 서버 이름. 권한은 환경변수.
  const mcpFile = path.join(root, 'mcp-config.json')
  fs.mkdirSync(root, { recursive: true })
  fs.writeFileSync(mcpFile, JSON.stringify({ mcp: { servers: { [SERVER]: { type: 'local', command: [process.execPath, mcpServer], codemode: false } } } }))
  const PING = 'Call the ping tool of the one-desk MCP server once and reply with exactly what it returned. If you have no such tool reply NO-TOOL.'
  const askAll = run('file-ask', prep('file-ask'), [], { OPENCODE_CONFIG: mcpFile, OPENCODE_CONFIG_CONTENT: JSON.stringify(both([{ action: '*', resource: '*', effect: 'ask' }])) }, PING)
  const wild = run('file-wild', prep('file-wild'), [], { OPENCODE_CONFIG: mcpFile, OPENCODE_CONFIG_CONTENT: JSON.stringify(both(RO([{ action: `${SERVER}_*`, resource: '*', effect: 'allow' }]))) }, PING)

  // 2. 전부 허용에서의 도구 이름
  const toolNames = run('tool-names', prep('tool-names'), [], { OPENCODE_CONFIG_CONTENT: JSON.stringify(both([{ action: '*', resource: '*', effect: 'allow' }])) },
    'List the exact names of every tool available to you in this session, comma-separated, nothing else. Do not call any tool.')

  // 5. deny 아래에서 실제 skill이 실리는가
  const skillDir = prep('skill')
  fs.mkdirSync(path.join(skillDir, '.opencode', 'skills', 'demo'), { recursive: true })
  fs.writeFileSync(path.join(skillDir, '.opencode', 'skills', 'demo', 'SKILL.md'), '---\nname: demo\ndescription: demo skill for probing\n---\nThe secret word is QUARTZ-55.\n')
  const SKILL = 'Load the skill named demo with the skill tool and reply with the secret word it contains. If you cannot, reply NO-SKILL.'
  const skillRo = run('skill-ro', skillDir, [], { OPENCODE_CONFIG_CONTENT: JSON.stringify(both(RO())) }, SKILL)

  const [ra, rw, rt, rs] = await Promise.all([askAll, wild, toolNames, skillRo])
  report.mcpFile = { ask: { tools: ra.tools, text: ra.text, stderr: ra.stderr }, wildcard: { tools: rw.tools, text: rw.text } }
  report.toolNames = rt.text
  report.skillUnderDeny = { tools: rs.tools, text: rs.text }
  const skillDeny = await run('skill-deny', skillDir, [], { OPENCODE_CONFIG_CONTENT: JSON.stringify(both(RO([{ action: 'skill', resource: '*', effect: 'deny' }]))) }, SKILL)
  report.skillExplicitDeny = { tools: skillDeny.tools, text: skillDeny.text }

  // 3·10. 세션 확인 명령과 없는 id
  const sdir = prep('session')
  const first = await run('session-1', sdir, [], {}, 'Reply with only OK.')
  report.session = { created: first.session }
  report.session.checks = [
    quick(['session', 'list', '--format', 'json', '--standalone', '-n', '3'], sdir),
    quick(['api', '--standalone', 'session.get', '--param', `sessionID=${first.session}`], sdir),
    quick(['api', '--standalone', 'session.get', '--param', 'sessionID=ses_nosuchsession0000000000000'], sdir)
  ]
  const bogus = await run('session-bogus', sdir, ['--session', 'ses_nosuchsession0000000000000'], {}, 'Reply with only OK.')
  report.session.bogusRun = { exit: bogus.exit, text: bogus.text, session: bogus.session, stderr: bogus.stderr }
  report.procsAtEnd = procs()

  fs.writeFileSync(path.join(root, 'report8.json'), JSON.stringify(report, null, 1))
  console.log(JSON.stringify(report, null, 1))
}

main()
