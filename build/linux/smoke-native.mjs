// 네이티브 모듈 둘(better-sqlite3·node-pty)을 실제로 불러 써 본다 (docs/sdlc/linux-glibc-floor/).
//
//   node build/linux/smoke-native.mjs <node_modules 폴더>
//
// build-native.sh는 다시 빌드한 직후 컨테이너(AlmaLinux 8 — RHEL 8과 같은 glibc·libstdc++) 안의 Node로, check-appimage.sh는
// 패키지의 Electron(껍데기를 거쳐 ELECTRON_RUN_AS_NODE)으로 부른다. 기호 버전 검사(check-glibc.sh)는 "로더가 받아 주는가"까지만
// 말한다 — 이것은 정말 뜨고 도는지 본다.
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = process.argv[2]
if (!root) {
  console.error('사용법: smoke-native.mjs <node_modules 폴더>')
  process.exit(2)
}

// 두 패키지 모두 진입점이 lib/index.js(CJS)다 — ESM에서 불러오면 module.exports가 default로 온다.
const load = async (pkg) => (await import(pathToFileURL(join(root, pkg, 'lib', 'index.js')).href)).default

const Database = await load('better-sqlite3')
const db = new Database(':memory:')
const row = db.prepare('select sqlite_version() as version, 6 * 7 as answer').get()
db.close()
if (row.answer !== 42) throw new Error(`better-sqlite3가 틀린 값을 돌려줬습니다: ${JSON.stringify(row)}`)

// 되울림이 아니라 셸이 계산한 글자를 기다린다
const pty = await load('node-pty')
const term = pty.spawn('/bin/sh', ['-c', 'echo pty-$((40 + 2))'], { cols: 80, rows: 24, env: process.env })
let out = ''
term.onData((data) => {
  out += data
})
const code = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`node-pty가 10초 안에 끝나지 않았습니다: ${JSON.stringify(out)}`)), 10_000)
  term.onExit(({ exitCode }) => {
    clearTimeout(timer)
    resolve(exitCode)
  })
})
if (code !== 0 || !out.includes('pty-42')) throw new Error(`node-pty: 종료 코드 ${code}, 출력 ${JSON.stringify(out)}`)

console.log(`smoke-native: better-sqlite3(SQLite ${row.version})와 node-pty가 뜨고 돈다`)
