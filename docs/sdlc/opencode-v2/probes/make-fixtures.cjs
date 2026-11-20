// 실측 원본(out-*.jsonl)에서 테스트 픽스처를 만든다. 저장소 루트에서: node docs/sdlc/opencode-v2/probes/make-fixtures.cjs
// 실측한 장비의 임시 폴더를 중립 경로로 바꾼다. 역슬래시가 몇 겹으로 이스케이프돼 있든(줄 전체가 JSON 글자다) 같은 겹으로 바꾼다.
const fs = require('node:fs')
const path = require('node:path')

const src = 'docs/sdlc/opencode-v2/probes'
const dst = 'core/runner/fixtures/opencode-v2'
const SCRATCH = /C:(\\+)Users\1[^\\]+\1AppData\1Local\1Temp\1claude\1[^\\]+\1[^\\]+\1scratchpad\1[a-z0-9]+\1[a-z0-9-]+/gi

fs.mkdirSync(dst, { recursive: true })
for (const [from, to] of [
  ['out-shapes-2.3.2.jsonl', 'shapes-2.3.2.jsonl'],
  ['out-shapes-2.0.18.jsonl', 'shapes-2.0.18.jsonl'],
  ['out-ask-all-2.3.2.jsonl', 'ask-all-2.3.2.jsonl']
]) {
  const lines = fs.readFileSync(path.join(src, from), 'utf8').split(/\r?\n/).filter(Boolean)
    .map((line) => line.replace(SCRATCH, (_match, sep) => `C:${sep}work${sep}repo`))
  for (const line of lines) JSON.parse(line)
  fs.writeFileSync(path.join(dst, to), `${lines.join('\n')}\n`)
  console.log(to, lines.length)
}
