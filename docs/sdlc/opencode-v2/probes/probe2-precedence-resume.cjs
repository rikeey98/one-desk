// opencode 2.x 실측 2차: 프로젝트의 구체 allow가 환경변수 deny를 다시 여는가, 세션 잇기, 해결된 권한 조회.
// 사용: node probe2.cjs <opencode.exe> <작업 폴더>
const { spawn, execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const [exe, root] = process.argv.slice(2)
const MODEL = 'opencode/big-pickle'
const TASK = 'Do exactly these two things with tools, then reply with the single word DONE. 1) Run the shell command: echo PROBE-SHELL 2) Create a file named made.txt containing the text hi'
const DENY_ALL = [{ action: '*', resource: '*', effect: 'deny' }, { action: 'read', resource: '*', effect: 'allow' }]
const SPECIFIC_ALLOW = ['shell', 'edit', 'write', 'bash'].map((action) => ({ action, resource: '*', effect: 'allow' }))

function prep(name, project) {
  const dir = path.join(root, name)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  execFileSync('git', ['init', '-q'], { cwd: dir })
  if (project) fs.writeFileSync(path.join(dir, 'opencode.json'), JSON.stringify(project))
  return dir
}

function run(name, dir, args, env, stdin) {
  return new Promise((resolve) => {
    const child = spawn(exe, ['run', '--standalone', '--format', 'json', '-m', MODEL, ...args], {
      cwd: dir, env: { ...process.env, ...env }, windowsHide: true
    })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { err += d })
    if (stdin) child.stdin.write(stdin)
    child.stdin.end()
    const timer = setTimeout(() => {
      try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F']) } catch { /* 이미 끝남 */ }
    }, 120_000)
    child.on('close', (code) => {
      clearTimeout(timer)
      fs.writeFileSync(path.join(root, `${name}.jsonl`), out)
      const tools = []
      const texts = []
      let session = null
      for (const line of out.split(/\r?\n/)) {
        let o
        try { o = JSON.parse(line) } catch { continue }
        session = o.sessionID ?? session
        if (o.type === 'tool_use') {
          const st = o.part?.state ?? {}
          tools.push(`${o.part?.tool}:${st.status}${st.error ? ` (${String(st.error).slice(0, 110)})` : ''}`)
        }
        if (o.type === 'text') texts.push(String(o.part?.text).slice(0, 160))
        if (o.type === 'error') texts.push(`ERROR ${JSON.stringify(o.error).slice(0, 300)}`)
      }
      resolve({
        name, exit: code, session, fileMade: fs.existsSync(path.join(dir, 'made.txt')), tools,
        lastText: texts.at(-1) ?? null, stderr: err.replace(/\x1b\[[0-9;]*m/g, '').trim().slice(0, 300)
      })
    })
  })
}

async function main() {
  const envDeny = { OPENCODE_CONFIG_CONTENT: JSON.stringify({ permissions: DENY_ALL }) }

  const reopen = run('specific-project-allow', prep('specific-project-allow', { permissions: SPECIFIC_ALLOW }), [TASK], envDeny)

  const resumeDir = prep('resume')
  const resume = (async () => {
    const first = await run('resume-1', resumeDir, ['Remember the code word ZEBRA-41. Reply with only OK.'], {})
    const second = await run('resume-2', resumeDir, ['--session', first.session, 'What was the code word? Reply with only the code word.'], {})
    const bogus = await run('resume-bogus', resumeDir, ['--session', 'ses_doesnotexist000000000000', 'Reply with only OK.'], {})
    return [first, second, bogus]
  })()

  const badModel = run('bad-model', prep('bad-model'), ['-m', 'opencode/no-such-model-xyz', 'Reply with only OK.'], {})

  for (const r of [await reopen, ...(await resume), await badModel]) console.log(JSON.stringify(r, null, 1))

  // 해결된 권한을 모델 없이 볼 수 있는가 — verifyRunnable의 재료
  const dir = prep('resolved', { permissions: SPECIFIC_ALLOW })
  const agents = execFileSync(exe, ['debug', 'agents', '--standalone'], { cwd: dir, env: { ...process.env, ...envDeny }, encoding: 'utf8' })
  const build = JSON.parse(agents).find((a) => a.id === 'build')
  console.log('build agent 권한(환경변수 deny + 프로젝트 구체 allow):')
  console.log(build.permissions.map((p) => `${p.action} ${p.resource} ${p.effect}`).join(' | '))
}

main()
