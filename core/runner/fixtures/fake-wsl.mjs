#!/usr/bin/env node
// 가짜 `wsl.exe` (docs/sdlc/wsl-support/ plan 14단계). 진짜 WSL이 없는 장비에서 "WSL repo의 프로세스가 어떤 모양으로
// 떴나"를 보는 데 쓴다 — interop·파이프·kill은 흉내내지 않는다(실측은 건너뛰기로 했다 — spec §4-A).
//
//   wsl.exe --list --quiet                       → UTF-16LE로 'Ubuntu\r\nDebian\r\n' (진짜와 같은 인코딩)
//   wsl.exe -d <D> -- wslpath -a -u <P>          → /mnt/<drive>/… (기본 automount 규칙; POSIX 개발 장비의 절대 경로는 /mnt/host/…)
//   wsl.exe -d <D> -- sh -c 'echo $HOME'         → /home/me
//   wsl.exe -d <D> -- test -x <P>                → exit 0 (ONE_DESK_FAKE_WSL_MISSING에 <P>가 있으면 1)
//   wsl.exe -d <D> -- bash -lc 'command -v claude' → ONE_DESK_FAKE_WSL_CLAUDE 또는 /home/me/.local/bin/claude
//   wsl.exe -d <D> -- kill …                     → exit 0
//   wsl.exe -d <D> [--cd <dir>] -- [/bin/sh <launcher> <pidfile>] <cmd> <args…>
//                                                → 런처는 건너뛰고 <cmd>를 그대로 띄운다(.mjs면 node로). pidfile에는 그 자식의
//                                                  **진짜 pid**를 쓴다 — 테스트의 가짜 killGroup이 그 pid를 죽여 "안에서 끝냈다"를
//                                                  흉내낸다(이 픽스처는 자식과 파이프를 나눠 쓰므로 자신만 죽으면 run이 안 끝난다).
//                                                  --cd가 실제 디렉토리가 아니면 지금 cwd.
//
// 받은 인자는 ONE_DESK_WSL_CAPTURE 파일에 JSON 한 줄씩 덧붙인다.
import { appendFileSync, existsSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'

const argv = process.argv.slice(2)
if (process.env.ONE_DESK_WSL_CAPTURE) {
  appendFileSync(process.env.ONE_DESK_WSL_CAPTURE, `${JSON.stringify({ argv, cwd: process.cwd() })}\n`)
}

if (argv[0] === '--list') {
  const body = Buffer.from('Ubuntu\r\nDebian\r\n', 'utf16le')
  process.stdout.write(Buffer.concat([Buffer.from([0xff, 0xfe]), body]))
  process.exit(0)
}

let i = 0
let cd = null
while (i < argv.length && argv[i] !== '--') {
  if (argv[i] === '-d') i += 2
  else if (argv[i] === '--cd') { cd = argv[i + 1]; i += 2 }
  else i += 1
}
const cmd = argv.slice(i + 1)

if (cmd[0] === 'wslpath') {
  const p = cmd[cmd.length - 1]
  const m = /^([a-zA-Z]):[\\/](.*)$/.exec(p)
  process.stdout.write(`${m ? `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}` : `/mnt/host${p.replace(/\\/g, '/')}`}\n`)
  process.exit(0)
}
if (cmd[0] === 'sh' && cmd[1] === '-c' && /echo \$HOME/.test(cmd[2] ?? '')) {
  process.stdout.write('/home/me\n')
  process.exit(0)
}
if (cmd[0] === 'test' && cmd[1] === '-x') {
  const missing = (process.env.ONE_DESK_FAKE_WSL_MISSING ?? '').split(':').filter(Boolean)
  process.exit(missing.includes(cmd[2]) ? 1 : 0)
}
if (cmd[0] === 'bash' && cmd[1] === '-lc' && /command -v claude/.test(cmd[2] ?? '')) {
  const found = process.env.ONE_DESK_FAKE_WSL_CLAUDE ?? '/home/me/.local/bin/claude'
  if (found === '') process.exit(1)
  process.stdout.write(`${found}\n`)
  process.exit(0)
}
if (cmd[0] === 'kill') process.exit(0)

let inner = cmd
let pidfile = null
if (inner[0] === '/bin/sh' && inner[1] && inner[1].endsWith('launcher.sh')) {
  pidfile = inner[2] ?? null
  inner = inner.slice(3)
}
const [exe, ...rest] = inner
const launcher = exe && exe.endsWith('.mjs') ? process.execPath : null
const child = spawn(launcher ?? exe, launcher ? [exe, ...rest] : rest, {
  cwd: cd && existsSync(cd) ? cd : process.cwd(),
  env: process.env,
  stdio: 'inherit'
})
if (pidfile && child.pid) { try { writeFileSync(pidfile, `${child.pid}\n`) } catch { /* 없는 폴더면 건너뛴다 */ } }
child.on('error', (err) => { process.stderr.write(`fake-wsl: ${err.message}\n`); process.exit(127) })
child.on('close', (code, signal) => { process.exit(code ?? (signal ? 128 : 1)) })
