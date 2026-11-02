import { describe, it, expect } from 'vitest'
import { blocksDrop, blocksPaste, stripRemoteFontSources } from './guards'

describe('들어오는 길 막기 (docs/sdlc/drawings/ spec FR-27)', () => {
  it('붙일 데이터에 파일이 있거나 이미지 요소가 섞였으면 막는다', () => {
    expect(blocksPaste({ files: { f1: {} } })).toBe(true)
    expect(blocksPaste({ elements: [{ type: 'rectangle' }, { type: 'image' }] })).toBe(true)
    expect(blocksPaste({ files: {}, elements: [{ type: 'rectangle' }] })).toBe(false)
    const textOnly: { text: string; files?: undefined } = { text: 'hello' }
    expect(blocksPaste(textOnly)).toBe(false)
    expect(blocksPaste({})).toBe(false)
  })

  it('파일을 끌어 놓으면 막는다 — 글자를 끌어 놓는 것은 둔다', () => {
    expect(blocksDrop({ files: { length: 1 } })).toBe(true)
    expect(blocksDrop({ files: { length: 0 } })).toBe(false)
    expect(blocksDrop(null)).toBe(false)
  })
})

describe('원격 대체 글꼴 걷기 (spec FR-30)', () => {
  const local = "url(file:///app/excalidraw-assets/fonts/Virgil/Virgil-Regular.woff2) format('woff2')"
  const remote = "url(https://esm.sh/@excalidraw/excalidraw@0.18.1/dist/prod/fonts/Virgil/Virgil-Regular.woff2) format('woff2')"

  it('esm.sh의 Excalidraw 원본만 걷는다', () => {
    expect(stripRemoteFontSources(`${local}, ${remote}`)).toBe(local)
  })

  it('그 밖의 원본은 그대로다', () => {
    expect(stripRemoteFontSources(local)).toBe(local)
    const other = "url(https://example.com/a.woff2) format('woff2')"
    expect(stripRemoteFontSources(`${local}, ${other}`)).toBe(`${local}, ${other}`)
    expect(stripRemoteFontSources("local('Arial')")).toBe("local('Arial')")
  })

  it('원본이 원격 하나뿐이면 그대로 둔다 — 빈 원본은 FontFace가 거부한다', () => {
    expect(stripRemoteFontSources(remote)).toBe(remote)
  })
})
