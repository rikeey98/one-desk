// opencode 2.x 실측 6차: (1) 읽기 전용에 execute를 열면 무엇이 되는가 (2) serve로 해결된 권한을 묻기.
// 사용: node probe6.cjs <opencode.exe> <작업 폴더> <mcp-ping.cjs>
const { spawn, execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const [exe, root, mcpServer] = process.argv.slice(2)
const MODEL = 'opencode/big-pickle'
const MCP = { servers: { onedesk: { type: 'local', command: [process.execPath, mcpServer] } } }
const RO = [{ action: '*', resource: '*', effect: 'deny' }, ...['read', 'grep', 'glob'].map((action) => ({ action, resource: '*', effect: 'allow' }))]
const withExecute = [...RO, { action: 'onedesk_*', resource: '*', effect: 'allow' }, { action: 'execute', resource: '*', effect: 'allow' }]
const config = (permissions) => ({ permissions, agents: { build: { permissions } }, mcp: MCP })

const EXEC_TASK = 'Call the execute tool exactly four times, once per code snippet below, verbatim, continuing even when one fails. Then reply with one line per snippet: the snippet number and its result or error.\n' +
  '1) return await tools.onedesk.ping()\n' +
  "2) return await tools.write({ path: 'x.txt', content: 'hi' })\n" +
  "3) return await tools.shell({ command: 'echo hi > z.txt' })\n" +
  "4) const fs = require('fs'); fs.writeFileSync('y.txt', 'hi'); return 'wrote'"

function prep(name) {
  const dir = path.join(root, name)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  execFileSync('git', ['init', '-q'], { cwd: dir })
  fs.writeFileSync(path.join(dir, 'a.txt'), 'hello\n')
  return dir
}

function kill(pid) {
  try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* 끝남 */ }
}

function runExec() {
  return new Promise((resolve) => {
    const dir = prep('execute-open')
    const child = spawn(exe, ['run', '--standalone', '--format', 'json', '--agent', 'build', '-m', MODEL, EXEC_TASK], {
      cwd: dir, env: { ...process.env, OPENCODE_CONFIG_CONTENT: JSON.stringify(config(withExecute)) }, windowsHide: true
    })
    let out = ''
    child.stdout.on('data', (d) => { out += d })
    child.stdin.end()
    const timer = setTimeout(() => kill(child.pid), 150_000)
    child.on('close', (code) => {
      clearTimeout(timer)
      fs.writeFileSync(path.join(root, 'execute-open.jsonl'), out)
      const calls = []
      let text = null
      for (const line of out.split(/\r?\n/)) {
        let o
        try { o = JSON.parse(line) } catch { continue }
        if (o.type === 'text') text = String(o.part?.text).slice(0, 500)
        if (o.type !== 'tool_use') continue
        const st = o.part?.state ?? {}
        calls.push({
          tool: o.part?.tool, status: st.status, code: String(st.input?.code ?? JSON.stringify(st.input)).slice(0, 90),
          out: String(st.output ?? st.error).slice(0, 160), inner: st.metadata?.metadata?.toolCalls, innerError: st.metadata?.metadata?.error
        })
      }
      resolve({
        exit: code, calls, text,
        files: Object.fromEntries(['x.txt', 'y.txt', 'z.txt'].map((f) => [f, fs.existsSync(path.join(dir, f))]))
      })
    })
  })
}

/** serve를 띄워 build agent의 해결된 규칙을 읽고 내린다 */
function serveAgents() {
  return new Promise((resolve) => {
    const dir = prep('serve-agents')
    fs.writeFileSync(path.join(dir, 'opencode.json'), JSON.stringify({ agents: { build: { permissions: [{ action: 'shell', resource: '*', effect: 'allow' }] } } }))
    const port = 47000 + Math.floor(Math.random() * 900)
    const started = Date.now()
    const child = spawn(exe, ['serve', '--port', String(port), '--hostname', '127.0.0.1'], {
      cwd: dir, env: { ...process.env, OPENCODE_CONFIG_CONTENT: JSON.stringify(config(RO)) }, windowsHide: true
    })
    let log = ''
    child.stdout.on('data', (d) => { log += d })
    child.stderr.on('data', (d) => { log += d })
    const finish = (result) => { kill(child.pid); resolve({ ...result, ms: Date.now() - started, log: log.replace(/server password \S+/, 'server password <가림>').slice(0, 200) }) }
    const deadline = Date.now() + 30_000
    let attempts = 0
    const poll = async () => {
      if (Date.now() > deadline) return finish({ error: 'timeout', attempts })
      const password = /server password (\S+)/.exec(log)?.[1]
      if (!password) return setTimeout(poll, 150)
      attempts++
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/agent`, {
          headers: { Authorization: 'Basic ' + Buffer.from(`opencode:${password}`).toString('base64') }
        })
        const body = await res.json()
        const build = (body.data ?? []).find((a) => a.id === 'build')
        if (!build) return setTimeout(poll, 200)
        finish({ attempts, build: build.permissions.map((p) => `${p.action} ${p.resource} ${p.effect}`).join(' | ') })
      } catch {
        setTimeout(poll, 200)
      }
    }
    poll()
  })
}

async function main() {
  const [exec, serve] = await Promise.all([runExec(), serveAgents()])
  console.log(JSON.stringify({ exec, serve }, null, 1))
}

main()
