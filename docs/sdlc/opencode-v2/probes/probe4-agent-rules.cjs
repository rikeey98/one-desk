// opencode 2.x 실측 4차 (모델 호출 없음): 프로젝트의 agent별 권한이 환경변수 규칙 뒤에 붙는가.
// 사용: node probe4.cjs <opencode.exe> <작업 폴더>
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const [exe, root] = process.argv.slice(2)
const DENY = [{ action: '*', resource: '*', effect: 'deny' }, { action: 'read', resource: '*', effect: 'allow' }]
const SHELL_ALLOW = [{ action: 'shell', resource: '*', effect: 'allow' }]

function resolved(name, project, envConfig, extraArgs = []) {
  const dir = path.join(root, name)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  execFileSync('git', ['init', '-q'], { cwd: dir })
  if (project) fs.writeFileSync(path.join(dir, 'opencode.json'), JSON.stringify(project))
  const started = Date.now()
  let out
  try {
    out = execFileSync(exe, ['debug', 'agents', '--standalone', ...extraArgs], {
      cwd: dir, encoding: 'utf8', env: { ...process.env, OPENCODE_CONFIG_CONTENT: JSON.stringify(envConfig) }
    })
  } catch (e) {
    console.log(`\n[${name}] 실패: ${String(e.stderr || e.message).slice(0, 300)}`)
    return
  }
  const agents = JSON.parse(out)
  console.log(`\n[${name}] ${Date.now() - started}ms, agents: ${agents.map((a) => `${a.id}(${a.mode})`).join(', ')}`)
  for (const a of agents.filter((x) => x.mode !== 'subagent' && !x.hidden)) {
    console.log(`  ${a.id}: ${a.permissions.map((p) => `${p.action} ${p.resource} ${p.effect}`).join(' | ')}`)
  }
}

// 1. 프로젝트가 build agent에 직접 allow를 건다
resolved('project-agent-allow', { agents: { build: { permissions: SHELL_ALLOW } } }, { permissions: DENY })
// 2. 같은 상황에서 환경변수도 agent별 권한을 건다
resolved('env-agent-deny', { agents: { build: { permissions: SHELL_ALLOW } } }, { permissions: DENY, agents: { build: { permissions: DENY } } })
// 3. 프로젝트가 새 primary agent를 만들고 기본 agent로 지정한다
resolved('project-default-agent', {
  default_agent: 'loose', agents: { loose: { mode: 'primary', description: 'x', permissions: SHELL_ALLOW } }
}, { permissions: DENY })
// 4. 환경변수가 default_agent를 build로 되돌린다
resolved('env-default-agent', {
  default_agent: 'loose', agents: { loose: { mode: 'primary', description: 'x', permissions: SHELL_ALLOW } }
}, { permissions: DENY, default_agent: 'build' })
