// opencode 2.x 실측 9차 (구현 1단계): MCP 설정 파일(timeout 포함)·없는 세션 id·auth list·편집으로 새 파일.
// 사용: node probe9-impl-step1.cjs <opencode.exe> <작업 폴더> <mcp-ping.cjs>
const { spawn, execFileSync, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const [exe, root, mcpServer] = process.argv.slice(2)
const MODEL = 'opencode/big-pickle'
const FULL = [{ action: '*', resource: '*', effect: 'allow' }]
const both = (permissions) => JSON.stringify({ permissions, agents: { build: { permissions } } })

function prep(name) {
  const dir = path.join(root, name)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  execFileSync('git', ['init', '-q'], { cwd: dir })
  return dir
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
    const timer = setTimeout(() => { try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* 끝남 */ } }, 120_000)
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
        if (o.type === 'tool_use') {
          const st = o.part?.state ?? {}
          tools.push({ tool: o.part?.tool, status: st.status, input: JSON.stringify(st.input).slice(0, 120), meta: JSON.stringify(st.metadata?.metadata).slice(0, 400), out: String(st.output ?? st.error).slice(0, 100) })
        }
        if (o.type === 'text') text = String(o.part?.text).slice(0, 200)
        if (o.type === 'error') text = `ERROR ${JSON.stringify(o.error).slice(0, 220)}`
      }
      resolve({ exit: code, tools, text, session, stderr: err.replace(/\x1b\[[0-9;]*m/g, '').trim().slice(0, 300) })
    })
  })
}

async function main() {
  fs.mkdirSync(root, { recursive: true })
  const mcpFile = path.join(root, 'mcp-config.json')
  fs.writeFileSync(mcpFile, JSON.stringify({
    mcp: { servers: { 'one-desk': { type: 'local', command: [process.execPath, mcpServer], environment: { PROBE: '1' }, codemode: false, timeout: { startup: 30000 } } } }
  }))

  const report = {}
  const auth = spawnSync(exe, ['auth', 'list', '--standalone'], { cwd: prep('auth'), encoding: 'utf8', timeout: 30_000, input: '' })
  report.authList = { exit: auth.status, out: String(auth.stdout).trim().slice(0, 200), err: String(auth.stderr).replace(/\x1b\[[0-9;]*m/g, '').trim().slice(0, 200) }

  const [mcp, edits, bogus] = await Promise.all([
    run('mcp-file-full', prep('mcp-file-full'), [], { OPENCODE_CONFIG: mcpFile, OPENCODE_CONFIG_CONTENT: both(FULL) },
      'Call the ping tool of the one-desk MCP server once and reply with exactly what it returned. If you have no such tool reply NO-TOOL.'),
    run('edit-new', prep('edit-new'), [], { OPENCODE_CONFIG_CONTENT: both(FULL) },
      'Do these with tools, one call each, then reply DONE. 1) Use the write tool to create w.txt containing: one. 2) Use the write tool again on w.txt with content: two. 3) Use the edit tool on w.txt replacing two with three.'),
    run('session-missing', prep('session-missing'), ['--session', `ses_missing${Date.now()}aaaaaaaaaaa`], { OPENCODE_CONFIG_CONTENT: both(FULL) }, 'Reply with only OK.')
  ])
  report.mcpFileFull = mcp
  report.edits = edits
  report.sessionMissing = bogus
  console.log(JSON.stringify(report, null, 1))
}

main()
