import { describe, it, expect, beforeEach } from 'vitest'
import {
  DOCK_HEIGHT_KEY, DEFAULT_DOCK_RATIO, MIN_DOCK_PX, MAX_DOCK_RATIO,
  clampDockHeight, readDockHeight, writeDockHeight
} from './dockHeight'

describe('기본값 (docs/sdlc/conversation-timeline/ spec FR-40)', () => {
  beforeEach(() => { localStorage.clear() })

  it('기본 높이는 창의 절반이다 — 입력 카드와 대화 헤더가 기본 높이에 들어가야 한다', () => {
    expect(DEFAULT_DOCK_RATIO).toBe(0.5)
  })

  it('하한은 280px이다 — 입력부가 고정되면(FR-41) 그보다 짧은 도크에서는 입력 카드가 잘린다', () => {
    expect(MIN_DOCK_PX).toBe(280)
    expect(clampDockHeight(200, 1000)).toBe(280)
  })

  it('저장된 옛 높이가 새 하한보다 작으면 읽을 때 올라간다 — 따로 옮길 것이 없다', () => {
    localStorage.setItem(DOCK_HEIGHT_KEY, '150')
    expect(readDockHeight(1000)).toBe(280)
  })
})

describe('clampDockHeight', () => {
  it('범위 안의 값은 그대로 둔다', () => {
    expect(clampDockHeight(400, 1000)).toBe(400)
  })

  it('너무 작으면 최소값으로 올린다 — 헤더만 남아 대화를 못 보는 상태를 막는다', () => {
    expect(clampDockHeight(10, 1000)).toBe(MIN_DOCK_PX)
  })

  it('너무 크면 최대 비율로 내린다 — 위 영역이 완전히 사라지지 않게 한다', () => {
    expect(clampDockHeight(990, 1000)).toBe(1000 * MAX_DOCK_RATIO)
  })

  it('숫자가 아닌 값은 기본 비율로 떨어진다 — NaN을 돌려주면 style이 통째로 무시된다', () => {
    // 드래그 계산이 한 번이라도 NaN을 만들면(포인터 이벤트에 좌표가 없는 등)
    // 높이가 사라져 도크가 접힌 것처럼 보인다. 여기서 막는다.
    expect(clampDockHeight(Number.NaN, 1000)).toBe(1000 * DEFAULT_DOCK_RATIO)
  })

  it('창이 최소값보다도 작으면 최대 비율이 이긴다', () => {
    // 200px 창에서 최소값(280)을 지키면 도크가 창을 넘는다. 넘지 않는 쪽을 택한다.
    expect(clampDockHeight(500, 200)).toBe(200 * MAX_DOCK_RATIO)
  })
})

describe('readDockHeight', () => {
  beforeEach(() => { localStorage.clear() })

  it('저장된 값이 없으면 기본 비율을 쓴다', () => {
    expect(readDockHeight(1000)).toBe(1000 * DEFAULT_DOCK_RATIO)
  })

  it('저장된 값을 되살린다', () => {
    localStorage.setItem(DOCK_HEIGHT_KEY, '450')
    expect(readDockHeight(1000)).toBe(450)
  })

  it('저장된 값도 지금 창 크기에 맞춰 클램프한다 — 큰 화면에서 저장하고 작은 화면에서 열 수 있다', () => {
    localStorage.setItem(DOCK_HEIGHT_KEY, '900')
    expect(readDockHeight(500)).toBe(500 * MAX_DOCK_RATIO)
  })

  it('망가진 값은 기본값으로 떨어진다', () => {
    localStorage.setItem(DOCK_HEIGHT_KEY, '어쩌구')
    expect(readDockHeight(1000)).toBe(1000 * DEFAULT_DOCK_RATIO)
  })
})

describe('writeDockHeight', () => {
  beforeEach(() => { localStorage.clear() })

  it('저장한 값을 readDockHeight가 되살린다', () => {
    writeDockHeight(420)
    expect(readDockHeight(1000)).toBe(420)
  })
})
