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
