// opencode 2.x 실측 7차: MCP 서버에 codemode:false를 걸면 execute 없이 도구가 직접 서는가.
// 사용: node probe7.cjs <opencode.exe> <작업 폴더> <mcp-ping.cjs>
const { spawn, execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const [exe, root, mcpServer] = process.argv.slice(2)
const RO = [{ action: '*', resource: '*', effect: 'deny' }, ...['read', 'grep', 'glob'].map((action) => ({ action, resource: '*', effect: 'allow' })), { action: 'onedesk_*', resource: '*', effect: 'allow' }]
const FULL = [{ action: '*', resource: '*', effect: 'allow' }]
const TASK = 'Call the ping tool from the onedesk MCP server once and reply with exactly what it returned. If no such tool is available to you, reply NO-TOOL.'

function run(name, permissions, codemode) {
  return new Promise((resolve) => {
    const dir = path.join(root, name)
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(dir, { recursive: true })
    execFileSync('git', ['init', '-q'], { cwd: dir })
    const server = { type: 'local', command: [process.execPath, mcpServer], ...(codemode === undefined ? {} : { codemode }) }
    const config = { permissions, agents: { build: { permissions } }, mcp: { servers: { onedesk: server } } }
    const child = spawn(exe, ['run', '--standalone', '--format', 'json', '--agent', 'build', '-m', 'opencode/big-pickle', TASK], {
      cwd: dir, env: { ...process.env, OPENCODE_CONFIG_CONTENT: JSON.stringify(config) }, windowsHide: true
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
      let text = null
      for (const line of out.split(/\r?\n/)) {
        let o
        try { o = JSON.parse(line) } catch { continue }
        if (o.type === 'tool_use') tools.push(`${o.part?.tool}:${o.part?.state?.status}`)
        if (o.type === 'text') text = String(o.part?.text).slice(0, 120)
        if (o.type === 'error') text = `ERROR ${JSON.stringify(o.error).slice(0, 200)}`
      }
      resolve({ name, exit: code, tools, text, stderr: err.replace(/\x1b\[[0-9;]*m/g, '').trim().slice(0, 200) })
    })
  })
}

Promise.all([
  run('ro-default', RO, undefined),
  run('ro-codemode-off', RO, false),
  run('full-default', FULL, undefined),
  run('full-codemode-off', FULL, false)
]).then((rs) => { for (const r of rs) console.log(JSON.stringify(r)) })
