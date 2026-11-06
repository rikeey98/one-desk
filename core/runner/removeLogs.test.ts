import { describe, it, expect, vi } from 'vitest'
import { join } from 'node:path'
import { createRunManager } from './manager'

const rm = vi.hoisted(() => vi.fn<(path: string, options: object) => Promise<void>>())

vi.mock('node:fs/promises', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:fs/promises')>(),
  rm
}))

describe('RunManager.removeLogs', () => {
  it('한 폴더를 못 지워도 던지지 않고 나머지를 지운다', async () => {
    const failure = new Error('EBUSY')
    rm.mockRejectedValueOnce(failure).mockResolvedValue(undefined)
    const onError = vi.fn()
    const manager = createRunManager({
      adapters: {} as never, logDir: 'logs-root', onEvent() {}, onError, onPlanUsage() {}
    })

    await expect(manager.removeLogs(['a', 'b'])).resolves.toBeUndefined()

    expect(rm.mock.calls.map(([path]) => path)).toEqual([join('logs-root', 'a'), join('logs-root', 'b')])
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('a'), failure)
  })
})
