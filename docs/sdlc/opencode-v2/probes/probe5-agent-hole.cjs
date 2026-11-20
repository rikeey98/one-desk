// opencode 2.x 실측 5차: 프로젝트의 agent별 allow가 실제로 셸을 여는가, 환경변수의 agent별 규칙이 그것을 덮는가.
// 사용: node probe5.cjs <opencode.exe> <작업 폴더>
const { spawn, execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const [exe, root] = process.argv.slice(2)
const TASK = 'Do exactly these two things with tools, then reply with the single word DONE. 1) Run the shell command: echo PROBE-SHELL 2) Create a file named made.txt containing the text hi'
const DENY = [{ action: '*', resource: '*', effect: 'deny' }, { action: 'read', resource: '*', effect: 'allow' }]
const OPEN = ['shell', 'edit'].map((action) => ({ action, resource: '*', effect: 'allow' }))
const PROJECT_BUILD = { agents: { build: { permissions: OPEN } } }
const PROJECT_LOOSE = { default_agent: 'loose', agents: { loose: { mode: 'primary', description: 'x', permissions: OPEN } } }

const cases = [
  { name: 'hole-agent-level', project: PROJECT_BUILD, env: { permissions: DENY }, args: [] },
  { name: 'fix-agent-level', project: PROJECT_BUILD, env: { permissions: DENY, agents: { build: { permissions: DENY } } }, args: [] },
  { name: 'hole-default-agent', project: PROJECT_LOOSE, env: { permissions: DENY, agents: { build: { permissions: DENY } } }, args: [] },
  { name: 'fix-pinned-agent', project: PROJECT_LOOSE, env: { permissions: DENY, agents: { build: { permissions: DENY } } }, args: ['--agent', 'build'] }
]

function run(c) {
  return new Promise((resolve) => {
    const dir = path.join(root, c.name)
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(dir, { recursive: true })
    execFileSync('git', ['init', '-q'], { cwd: dir })
    fs.writeFileSync(path.join(dir, 'opencode.json'), JSON.stringify(c.project))
    const child = spawn(exe, ['run', '--standalone', '--format', 'json', '-m', 'opencode/big-pickle', ...c.args, TASK], {
      cwd: dir, env: { ...process.env, OPENCODE_CONFIG_CONTENT: JSON.stringify(c.env) }, windowsHide: true
    })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { err += d })
    child.stdin.end()
    const timer = setTimeout(() => { try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F']) } catch { /* 끝남 */ } }, 120_000)
    child.on('close', (code) => {
      clearTimeout(timer)
      const tools = []
      for (const line of out.split(/\r?\n/)) {
        let o
        try { o = JSON.parse(line) } catch { continue }
        if (o.type === 'tool_use') tools.push(`${o.part?.tool}:${o.part?.state?.status}`)
        if (o.type === 'error') tools.push(`ERROR ${JSON.stringify(o.error).slice(0, 160)}`)
      }
      resolve({ name: c.name, exit: code, fileMade: fs.existsSync(path.join(dir, 'made.txt')), tools, stderr: err.replace(/\x1b\[[0-9;]*m/g, '').trim().slice(0, 200) })
    })
  })
}

Promise.all(cases.map(run)).then((rs) => { for (const r of rs) console.log(JSON.stringify(r)) })
