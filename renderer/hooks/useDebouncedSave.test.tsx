import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDebouncedSave } from './useDebouncedSave'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('useDebouncedSave', () => {
  it('입력이 멎어야 저장한다', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useDebouncedSave(save, 600))

    act(() => { result.current.schedule('a') })
    act(() => { result.current.schedule('ab') })
    expect(save).not.toHaveBeenCalled()

    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('ab')
  })

  it('flush는 대기 중인 저장을 즉시 실행한다', async () => {
    // 패널을 접거나 항목을 옮길 때 부른다. 없으면 타이머가 도는 도중에 내용이 날아간다.
    const save = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useDebouncedSave(save, 600))

    act(() => { result.current.schedule('ab') })
    await act(async () => { await result.current.flush() })
    expect(save).toHaveBeenCalledWith('ab')

    // 이미 비웠으므로 타이머가 지나도 다시 부르지 않는다
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('flush가 거부돼도 훅이 멈추지 않는다 — 재시도하지 않고, 이후 schedule은 정상 동작한다', async () => {
    // 타이머 경로(schedule → setTimeout → void flush())는 반환값을 아무도 기다리지
    // 않아 save가 거부되면 처리되지 않은 프라미스 거부로 남는다(docstring 참고) —
    // 그 자체는 이 프로젝트의 renderer/Node API 경계 안에서 안전하게 관측할 방법이
    // 없다(아래 "디바운스 경로의 거부 관측" 절 참고). 하지만 타이머가 부르는 것도,
    // flush를 직접 불러 기다리는 것도 같은 flush 구현이다 — 여기서는 그 구현을
    // 테스트가 스스로 기다리고 잡는 방식으로 불러, 디바운스가 실제로 기대는 상태
    // 복구 계약(pending/timer가 정리되고, 실패한 값이 재시도되지 않고, 다음
    // schedule이 계속 동작하는지)을 처리되지 않은 거부 없이 검증한다.
    const err = new Error('DB 오류')
    const save = vi.fn()
      .mockRejectedValueOnce(err)
      .mockResolvedValue(undefined)
    const { result } = renderHook(() => useDebouncedSave(save, 600))

    act(() => { result.current.schedule('ab') })
    await act(async () => {
      await expect(result.current.flush()).rejects.toThrow('DB 오류')
    })
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenNthCalledWith(1, 'ab')

    // 재시도하지 않는다 — 실패한 값이 남아 있었다면 타이머가 지날 때 다시 불렸을 것이다.
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    expect(save).toHaveBeenCalledTimes(1)

    // 훅이 멈추지 않는다 — 거부 이후에도 새 schedule은 정상적으로 디바운스돼 저장된다.
    act(() => { result.current.schedule('cd') })
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    expect(save).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenNthCalledWith(2, 'cd')
  })

  it('flush는 타이머도 함께 정리한다', async () => {
    // flush가 pending만 비우고 타이머를 그대로 두면, 이미 저장을 끝낸 뒤에도
    // 디바운스 타이머가 계속 떠 있는다 — save는 다시 불리지 않지만(pending이 이미
    // 비었으므로) 쓸모없는 타이머 하나가 계속 남는다. 공개 API로는 이 차이가
    // 드러나지 않아 vi.getTimerCount()로 내부 타이머 큐를 직접 확인한다.
    const save = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useDebouncedSave(save, 600))

    act(() => { result.current.schedule('ab') })
    expect(vi.getTimerCount()).toBe(1)
    await act(async () => { await result.current.flush() })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('대기 중인 것이 없으면 flush가 아무것도 하지 않는다', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useDebouncedSave(save, 600))
    await act(async () => { await result.current.flush() })
    expect(save).not.toHaveBeenCalled()
  })

  it('cancel은 대기 중인 저장을 버린다', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useDebouncedSave(save, 600))
    act(() => { result.current.schedule('ab') })
    act(() => { result.current.cancel() })
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    expect(save).not.toHaveBeenCalled()
  })

  it('언마운트되면 대기 중인 저장을 흘려보낸다', () => {
    // 패널을 접거나 다른 항목으로 옮기면 상세가 언마운트된다. 여기서 버리면
    // 디바운스가 끝나기 전에 친 내용이 그대로 날아간다.
    // 결과를 받을 컴포넌트가 없어 오류는 관측되지 않지만, 쓰기를 잃는 쪽이 더 나쁘다.
    const save = vi.fn().mockResolvedValue(undefined)
    const { result, unmount } = renderHook(() => useDebouncedSave(save, 600))
    act(() => { result.current.schedule('ab') })
    unmount()
    expect(save).toHaveBeenCalledWith('ab')
  })

  it('대기 중인 것이 없으면 언마운트가 저장하지 않는다', () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const { unmount } = renderHook(() => useDebouncedSave(save, 600))
    unmount()
    expect(save).not.toHaveBeenCalled()
  })
})
