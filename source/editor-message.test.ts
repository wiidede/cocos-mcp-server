import { beforeEach, describe, expect, it, vi } from 'vitest'
import { requestAssetDb, requestScene } from './editor-message'

const request = vi.fn<(...args: unknown[]) => Promise<unknown>>()

beforeEach(() => {
  request.mockReset()
  vi.stubGlobal('Editor', {
    Message: { request },
  })
})

describe('editor message adapter', () => {
  it('forwards scene node queries with their UUID', async () => {
    request.mockResolvedValue({ uuid: { value: 'node-1' } })

    await expect(requestScene('query-node', 'node-1')).resolves.toEqual({ uuid: { value: 'node-1' } })
    expect(request).toHaveBeenCalledWith('scene', 'query-node', 'node-1')
  })

  it('forwards asset queries with typed options', async () => {
    request.mockResolvedValue([{ uuid: 'scene-1', url: 'db://assets/Main.scene', name: 'Main' }])

    await expect(requestAssetDb('query-assets', { pattern: 'db://assets/**/*.scene' })).resolves.toHaveLength(1)
    expect(request).toHaveBeenCalledWith('asset-db', 'query-assets', { pattern: 'db://assets/**/*.scene' })
  })

  it('supports zero-argument scene queries', async () => {
    request.mockResolvedValue(true)

    await expect(requestScene('query-is-ready')).resolves.toBe(true)
    expect(request).toHaveBeenCalledWith('scene', 'query-is-ready')
  })
})
