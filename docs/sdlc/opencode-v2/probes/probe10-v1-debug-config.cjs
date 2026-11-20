// 1.x 긍정 확인의 전제 (spec FR-9): `debug config`의 permission이 우리가 보낸 키·값을 그대로 담는가. 모델 호출 없음.
// 사용: node probe10-v1-debug-config.cjs <opencode 1.x exe> <빈 폴더>
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const [exe, root] = process.argv.slice(2)
const KEYS = ['bash', 'doom_loop', 'edit', 'external_directory', 'glob', 'grep', 'list', 'lsp', 'question', 'read', 'skill', 'task', 'todowrite', 'webfetch', 'websearch']
const READ = ['read', 'glob', 'grep', 'list', 'lsp', 'todowrite', 'webfetch', 'websearch']
const sent = { '*': 'deny' }
for (const k of KEYS) sent[k] = READ.includes(k) ? 'allow' : 'deny'
sent['one-desk_*'] = 'allow'

function check(name, project) {
  const dir = path.join(root, name)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  execFileSync('git', ['init', '-q'], { cwd: dir })
  if (project) fs.writeFileSync(path.join(dir, 'opencode.json'), JSON.stringify(project))
  const out = execFileSync(exe, ['debug', 'config'], { cwd: dir, encoding: 'utf8', env: { ...process.env, OPENCODE_PERMISSION: JSON.stringify(sent) } })
  const permission = JSON.parse(out).permission
  const differing = Object.entries(sent).filter(([k, v]) => permission?.[k] !== v).map(([k]) => `${k}=${JSON.stringify(permission?.[k])}`)
  const extra = Object.keys(permission ?? {}).filter((k) => !(k in sent))
  console.log(`[${name}] 다른 키: ${differing.join(', ') || '없음'} | 우리가 안 보낸 키: ${extra.map((k) => `${k}=${JSON.stringify(permission[k])}`).join(', ') || '없음'}`)
}

check('plain', null)
check('project-string', { permission: { bash: 'allow', edit: 'ask' } })
check('project-object', { permission: { bash: { 'git *': 'allow', '*': 'ask' }, mytool: 'ask' } })
