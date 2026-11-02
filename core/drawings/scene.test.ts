import { describe, it, expect } from 'vitest'
import { assertScene, EMPTY_SCENE, MAX_SCENE_CHARS } from './scene'

describe('장면 검증 (docs/sdlc/drawings/ spec FR-3)', () => {
  it('빈 장면은 통과하고 Excalidraw 파일과 같은 머리를 가진다', () => {
    expect(() => assertScene(EMPTY_SCENE)).not.toThrow()
    expect(JSON.parse(EMPTY_SCENE)).toEqual({ type: 'excalidraw', version: 2, source: 'one-desk', elements: [] })
  })

  it('요소의 종류는 보지 않는다 — 묘비·이미지가 섞여도 통과한다', () => {
    const scene = JSON.stringify({ elements: [{ id: 'a', type: 'rectangle', isDeleted: true }, { id: 'b', type: 'image' }] })
    expect(() => assertScene(scene)).not.toThrow()
  })

  it('JSON이 아니면 던진다', () => {
    expect(() => assertScene('{')).toThrow(/그림을 읽을 수 없습니다/)
  })

  it('객체가 아니거나 elements가 배열이 아니면 던진다', () => {
    expect(() => assertScene('[]')).toThrow(/elements/)
    expect(() => assertScene('null')).toThrow(/elements/)
    expect(() => assertScene('{"elements":{}}')).toThrow(/elements/)
  })

  it('id가 문자열이 아닌 요소가 있으면 던진다', () => {
    expect(() => assertScene('{"elements":[{"id":1}]}')).toThrow(/요소/)
    expect(() => assertScene('{"elements":[null]}')).toThrow(/요소/)
  })

  it('상한을 넘으면 던진다 — 상한 그대로는 통과한다', () => {
    const head = '{"elements":[],"pad":"'
    const tail = '"}'
    const exact = head + 'x'.repeat(MAX_SCENE_CHARS - head.length - tail.length) + tail
    expect(exact.length).toBe(MAX_SCENE_CHARS)
    expect(() => assertScene(exact)).not.toThrow()
    expect(() => assertScene(exact.replace('"pad":"', '"pad":"x'))).toThrow(/너무 큽니다/)
  })
})
