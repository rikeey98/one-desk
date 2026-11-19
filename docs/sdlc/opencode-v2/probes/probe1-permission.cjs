// opencode 2.x 권한·입력 통로 실측. 사용: node probe.cjs <opencode.exe> <작업 폴더>
const { spawn, execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const [exe, root] = process.argv.slice(2)
const MODEL = 'opencode/big-pickle'
const TASK = 'Do exactly these two things with tools, then reply with the single word DONE. 1) Run the shell command: echo PROBE-SHELL 2) Create a file named made.txt containing the text hi'
const DENY_ALL = [{ action: '*', resource: '*', effect: 'deny' }, { action: 'read', resource: '*', effect: 'allow' }]

const cases = [
  { name: 'baseline', args: [TASK] },
  { name: 'env-deny', env: { OPENCODE_CONFIG_CONTENT: JSON.stringify({ permissions: DENY_ALL }) }, args: [TASK] },
  {
    name: 'env-deny-vs-project-allow',
    env: { OPENCODE_CONFIG_CONTENT: JSON.stringify({ permissions: DENY_ALL }) },
    project: { permissions: [{ action: '*', resource: '*', effect: 'allow' }] },
    args: [TASK]
  },
  {
    name: 'project-deny-only',
    project: { permissions: DENY_ALL },
    args: [TASK]
  },
  {
    name: 'env-ask',
    env: { OPENCODE_CONFIG_CONTENT: JSON.stringify({ permissions: [{ action: 'shell', resource: '*', effect: 'ask' }, { action: 'edit', resource: '*', effect: 'ask' }, { action: 'write', resource: '*', effect: 'ask' }] }) },
    args: [TASK]
  },
  { name: 'auto-vs-env-deny', env: { OPENCODE_CONFIG_CONTENT: JSON.stringify({ permissions: DENY_ALL }) }, args: ['--auto', TASK] },
  { name: 'stdin-prompt', args: [], stdin: 'Reply with the single word STDIN-OK and nothing else.' }
]

function run(c) {
  return new Promise((resolve) => {
    const dir = path.join(root, c.name)
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(dir, { recursive: true })
    execFileSync('git', ['init', '-q'], { cwd: dir })
    if (c.project) fs.writeFileSync(path.join(dir, 'opencode.json'), JSON.stringify(c.project))
    const started = Date.now()
    const child = spawn(exe, ['run', '--standalone', '--format', 'json', '--archived', '-m', MODEL, ...c.args], {
      cwd: dir, env: { ...process.env, ...(c.env ?? {}) }, windowsHide: true
    })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { err += d })
    if (c.stdin) child.stdin.write(c.stdin)
    child.stdin.end()
    const timer = setTimeout(() => {
      try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F']) } catch { /* 이미 끝남 */ }
    }, 120_000)
    child.on('close', (code) => {
      clearTimeout(timer)
      fs.writeFileSync(path.join(root, `${c.name}.jsonl`), out)
      fs.writeFileSync(path.join(root, `${c.name}.err`), err)
      const tools = []
      const texts = []
      const types = new Set()
      for (const line of out.split(/\r?\n/)) {
        let o
        try { o = JSON.parse(line) } catch { continue }
        types.add(o.type)
        if (o.type === 'tool_use') {
          const st = o.part?.state ?? {}
          tools.push(`${o.part?.tool}:${st.status}${st.error ? ` (${String(st.error).slice(0, 110)})` : ''}`)
        }
        if (o.type === 'text') texts.push(String(o.part?.text).slice(0, 140))
        if (o.type === 'error') texts.push(`ERROR ${JSON.stringify(o.error).slice(0, 200)}`)
      }
      resolve({
        name: c.name, exit: code, secs: Math.round((Date.now() - started) / 1000),
        fileMade: fs.existsSync(path.join(dir, 'made.txt')),
        types: [...types].join(','), tools, lastText: texts.at(-1) ?? null,
        stderr: err.replace(/\x1b\[[0-9;]*m/g, '').trim().slice(0, 300)
      })
    })
  })
}

Promise.all(cases.map(run)).then((results) => {
  for (const r of results) console.log(JSON.stringify(r, null, 1))
})
