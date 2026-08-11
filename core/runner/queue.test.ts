import { describe, it, expect, vi } from 'vitest'
import { createRunQueue } from './queue'

/** 시작된 순서를 기록하는 큐. 대부분의 테스트가 이걸로 충분하다. */
function makeQueue(limit: number) {
  const started: string[] = []
  const queue = createRunQueue({ limit })
  const add = (id: string) => queue.enqueue(id, () => { started.push(id) })
  return { queue, started, add }
}

describe('createRunQueue', () => {
  it('상한까지는 즉시 시작하고 초과분은 대기시킨다', () => {
    const { queue, started, add } = makeQueue(2)
    add('a'); add('b'); add('c')
    expect(started).toEqual(['a', 'b'])
    expect(queue.snapshot()).toEqual({ running: 2, limit: 2, waiting: 1 })
  })

  it('슬롯이 있으면 enqueue가 start를 동기로 부른다', () => {
    // 비동기로 미루면 execution.start()가 running run을 못 돌려주고
    // 도크 탭이 늦게 뜬다 — 이미 고정해 둔 계약이 깨진다.
    const started: string[] = []
    const queue = createRunQueue({ limit: 1 })
    queue.enqueue('a', () => { started.push('a') })
    expect(started).toEqual(['a'])
  })

  it('release하면 대기열에서 FIFO 순으로 다음이 시작한다', () => {
    const { queue, started, add } = makeQueue(1)
    add('a'); add('b'); add('c')
    expect(started).toEqual(['a'])
    queue.release('a')
    expect(started).toEqual(['a', 'b'])
    queue.release('b')
    expect(started).toEqual(['a', 'b', 'c'])
  })

  it('대기 중인 것은 remove로 뺄 수 있고, 실행 중인 것은 false다', () => {
    const { queue, started, add } = makeQueue(1)
    add('a'); add('b')
    expect(queue.remove('b')).toBe(true)
    expect(queue.remove('a')).toBe(false)
    expect(queue.snapshot()).toEqual({ running: 1, limit: 1, waiting: 0 })
    queue.release('a')
    expect(started).toEqual(['a'])
  })

  it('없는 id를 remove하면 false다', () => {
    const { queue } = makeQueue(1)
    expect(queue.remove('없음')).toBe(false)
  })

  it('상한을 낮춰도 돌던 것을 죽이지 않고 새로 시작하지도 않는다', () => {
    const { queue, started, add } = makeQueue(3)
    add('a'); add('b'); add('c'); add('d')
    expect(started).toEqual(['a', 'b', 'c'])
    queue.setLimit(1)
    expect(started).toEqual(['a', 'b', 'c'])
    // 넘긴 상태를 그대로 드러낸다. 감추면 왜 새 run이 안 뜨는지 알 수 없다.
    expect(queue.snapshot()).toEqual({ running: 3, limit: 1, waiting: 1 })
    queue.release('a'); queue.release('b')
    expect(started).toEqual(['a', 'b', 'c'])
    queue.release('c')
    expect(started).toEqual(['a', 'b', 'c', 'd'])
  })

  it('상한을 올리면 대기분이 즉시 시작한다', () => {
    const { queue, started, add } = makeQueue(1)
    add('a'); add('b'); add('c')
    queue.setLimit(3)
    expect(started).toEqual(['a', 'b', 'c'])
  })

  it('start가 던져도 슬롯을 돌려주고 다음 대기분으로 넘어간다', () => {
    // 여기서 던지게 두면 뒤에 남은 대기분이 영영 흐르지 않는다.
    const started: string[] = []
    const queue = createRunQueue({ limit: 1 })
    queue.enqueue('a', () => { throw new Error('시작 실패') })
    queue.enqueue('b', () => { started.push('b') })
    expect(started).toEqual(['b'])
    expect(queue.snapshot()).toEqual({ running: 1, limit: 1, waiting: 0 })
  })

  it('start 안에서 release를 불러도 재귀가 쌓이지 않는다', () => {
    // 유령 run 경로다 — run 행이 사라지면 execution이 start 안에서 곧바로 release한다.
    // 가드가 없으면 release가 다시 pump를 부르며 대기열 길이만큼 스택이 깊어지고,
    // 충분히 길면 스택 오버플로가 pump의 catch에 삼켜져 큐가 조용히 멈춘다.
    //
    // 재진입 시점에 대기열이 비어 있으면 가드가 있으나 없으나 결과가 같다.
    // 그래서 슬롯을 점유만 하는 run을 먼저 넣어 뒤의 유령들을 대기시킨 뒤 풀어준다.
    const queue = createRunQueue({ limit: 1 })
    const started: string[] = []
    let depth = 0
    let maxDepth = 0

    const ghost = (id: string) => () => {
      depth += 1
      maxDepth = Math.max(maxDepth, depth)
      started.push(id)
      queue.release(id)
      depth -= 1
    }

    queue.enqueue('holder', () => { started.push('holder') })
    queue.enqueue('a', ghost('a'))
    queue.enqueue('b', ghost('b'))
    queue.enqueue('c', ghost('c'))

    queue.release('holder')

    expect(started).toEqual(['holder', 'a', 'b', 'c'])
    // 가드가 없으면 a→b→c가 서로의 안에서 시작해 3까지 깊어진다.
    expect(maxDepth).toBe(1)
    expect(queue.snapshot()).toEqual({ running: 0, limit: 1, waiting: 0 })
  })

  it('바뀔 때마다 onChange로 새 스냅샷을 준다', () => {
    const onChange = vi.fn()
    const queue = createRunQueue({ limit: 1, onChange })
    queue.enqueue('a', () => {})
    expect(onChange).toHaveBeenLastCalledWith({ running: 1, limit: 1, waiting: 0 })
    queue.enqueue('b', () => {})
    expect(onChange).toHaveBeenLastCalledWith({ running: 1, limit: 1, waiting: 1 })
    queue.release('a')
    expect(onChange).toHaveBeenLastCalledWith({ running: 1, limit: 1, waiting: 0 })
  })
})
