/**
 * 터미널에서 고른 글을 대화 입력칸에 넣을 모양으로 만든다 — 코드 울타리로 감싼다. 터미널 출력은 공백·줄 맞춤이 뜻이라
 * 평문으로 넣으면 agent가 지시와 출력을 가르지 못한다.
 *
 * 줄 끝 공백과 앞뒤 빈 줄은 걷는다(xterm은 줄 폭만큼 공백을 채워 준다). 울타리는 글 안의 가장 긴 backtick 줄보다 길게
 * 잡는다 — 출력에 ```가 있으면 거기서 블록이 닫힌다. 남는 것이 없으면 null이다. 끝의 줄바꿈은 커서가 블록 밖 새 줄에
 * 서게 하려는 것이다.
 */
export function terminalSelectionBlock(selection: string): string | null {
  const text = selection
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .join('\n')
    .replace(/^\n+|\n+$/g, '')
  if (text === '') return null
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length))
  const fence = '`'.repeat(Math.max(3, longest + 1))
  return `${fence}\n${text}\n${fence}\n`
}
