export interface SlashToken {
  start: number
  end: number
  query: string
}

export function findSlashToken(text: string, cursor: number): SlashToken | null {
  const before = text.slice(0, cursor)
  const match = /(?:^|\s)(\/[^\s]*)$/.exec(before)
  if (!match) return null
  const start = cursor - match[1]!.length
  const prefix = text.slice(0, start).trim()
  if (prefix && !prefix.split(/\s+/).every((part) => part.startsWith('/'))) return null
  const rest = text.slice(cursor).match(/^\S*/)?.[0] ?? ''
  return { start, end: cursor + rest.length, query: match[1]!.slice(1) }
}

export function insertCommand(text: string, token: SlashToken, name: string) {
  const inserted = `/${name} `
  const after = text.slice(token.end).replace(/^ /, '')
  return {
    text: text.slice(0, token.start) + inserted + after,
    cursor: token.start + inserted.length
  }
}

/** 토큰을 `name`으로 바꾸되 공백은 붙이지 않는다 — 셸의 Tab처럼 피커가 열린 채로 남는다. */
export function extendCommand(text: string, token: SlashToken, name: string) {
  const inserted = `/${name}`
  return {
    text: text.slice(0, token.start) + inserted + text.slice(token.end),
    cursor: token.start + inserted.length
  }
}

export function commonPrefix(names: string[]): string {
  if (names.length === 0) return ''
  let prefix = names[0]!
  for (const name of names) {
    let i = 0
    while (i < prefix.length && i < name.length && prefix[i] === name[i]) i++
    prefix = prefix.slice(0, i)
  }
  return prefix
}

/**
 * 질의와 이름·설명이 얼마나 맞는지. 작을수록 앞에 온다. 등급 밖이면 null.
 *
 * 0 이름 앞글자 · 1 이름 중간 · 2 설명 · 3 글자 건너뛰기 · 4 한 글자 오타.
 * 오타는 세 글자부터 봐준다 — 두 글자에서 한 글자를 틀리면 거의 모든 이름이 걸린다.
 */
function matchRank(name: string, description: string | null, query: string): number | null {
  if (name.startsWith(query)) return 0
  if (name.includes(query)) return 1
  if (description?.includes(query)) return 2
  if (isSubsequence(query, name)) return 3
  if (query.length >= 3 && [-1, 0, 1].some((d) => withinOneEdit(query, name.slice(0, query.length + d)))) return 4
  return null
}

export function matchCommands<T extends { name: string; description: string | null }>(commands: T[], query: string): T[] {
  const q = query.toLocaleLowerCase()
  return commands
    .map((command, index) => ({ command, index, rank: matchRank(command.name.toLocaleLowerCase(), command.description?.toLocaleLowerCase() ?? null, q) }))
    .filter((entry): entry is typeof entry & { rank: number } => entry.rank !== null)
    // 같은 등급 안에서는 원래 순서 — 정렬이 안정적이지 않은 환경도 있어 index로 못 박는다.
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.command)
}

function isSubsequence(query: string, name: string): boolean {
  let i = 0
  for (const ch of name) if (ch === query[i]) i++
  return i === query.length
}

/** 치환·자리바꿈·한 글자 빠짐·한 글자 끼어듦 중 하나까지. */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true
  if (Math.abs(a.length - b.length) > 1) return false
  if (a.length === b.length) {
    const diff: number[] = []
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff.push(i)
    if (diff.length === 1) return true
    const [x, y] = diff
    return diff.length === 2 && y === x! + 1 && a[x!] === b[y!] && a[y!] === b[x!]
  }
  const [short, long] = a.length < b.length ? [a, b] : [b, a]
  let i = 0, j = 0, skipped = false
  while (i < short.length && j < long.length) {
    if (short[i] === long[j]) { i++; j++ }
    else if (skipped) return false
    else { skipped = true; j++ }
  }
  return true
}
