import { afterEach, describe, expect, it, vi } from 'vitest'
import { SceneAdvancedTools } from './scene-advanced-tools'

describe('scene advanced undo recording', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('starts an explicit multi-target recording and returns its undoId', async () => {
    const request = vi.fn().mockResolvedValue('undo-1')
    vi.stubGlobal('Editor', { Message: { request } })
    const tools = new SceneAdvancedTools()

    await expect(tools.execute('begin_undo_recording', {
      nodeUuids: ['node-a', 'node-b'],
      label: 'Batch edit sprites',
    })).resolves.toMatchObject({
      success: true,
      data: {
        undoId: 'undo-1',
        nodeUuids: ['node-a', 'node-b'],
        label: 'Batch edit sprites',
      },
    })
    expect(request).toHaveBeenCalledWith('scene', 'begin-recording', ['node-a', 'node-b'], {
      auto: false,
      tag: 'Batch edit sprites',
    })
  })

  it('uses the returned undoId for end and cancel', async () => {
    const request = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('Editor', { Message: { request } })
    const tools = new SceneAdvancedTools()

    await expect(tools.execute('end_undo_recording', { undoId: 'undo-1' })).resolves.toMatchObject({ success: true })
    await expect(tools.execute('cancel_undo_recording', { undoId: 'undo-2' })).resolves.toMatchObject({ success: true })
    expect(request).toHaveBeenNthCalledWith(1, 'scene', 'end-recording', 'undo-1')
    expect(request).toHaveBeenNthCalledWith(2, 'scene', 'cancel-recording', 'undo-2')
  })

  it('rejects missing targets and invalid editor results', async () => {
    const request = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('Editor', { Message: { request } })
    const tools = new SceneAdvancedTools()

    await expect(tools.execute('begin_undo_recording', {})).resolves.toMatchObject({ success: false })
    await expect(tools.execute('begin_undo_recording', { nodeUuid: 'node-a' })).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('valid undoId'),
    })
  })
})

describe('scene advanced prefab restore', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('checks the restore result and verifies the persisted prefab association', async () => {
    const request = vi.fn(async (_channel: string, message: string) => {
      if (message === 'restore-prefab')
        return true
      if (message === 'query-nodes-by-asset-uuid')
        return ['node-1']
      throw new Error(`Unexpected message: ${message}`)
    })
    vi.stubGlobal('Editor', { Message: { request } })

    await expect(new SceneAdvancedTools().execute('restore_prefab', {
      nodeUuid: 'node-1',
      assetUuid: 'prefab-1',
    })).resolves.toMatchObject({ success: true, data: { restored: true, prefabLinked: true } })
    expect(request).toHaveBeenNthCalledWith(1, 'scene', 'restore-prefab', 'node-1', 'prefab-1')
    expect(request).toHaveBeenNthCalledWith(2, 'scene', 'query-nodes-by-asset-uuid', 'prefab-1')
  })

  it('does not report success when Cocos rejects the restore', async () => {
    const request = vi.fn().mockResolvedValue(false)
    vi.stubGlobal('Editor', { Message: { request } })

    await expect(new SceneAdvancedTools().execute('restore_prefab', {
      nodeUuid: 'node-1',
      assetUuid: 'prefab-1',
    })).resolves.toMatchObject({ success: false, data: { restored: false, prefabLinked: false } })
    expect(request).toHaveBeenCalledTimes(1)
  })
})
