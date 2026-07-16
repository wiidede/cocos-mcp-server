import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PrefabTools } from './prefab-tools'

describe('prefab tools editor integration', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('opens prefab edit mode through the registered asset-db message', async () => {
    const request = vi.fn(async (channel: string, message: string, argument: unknown) => {
      if (channel === 'asset-db' && message === 'query-asset-info')
        return { uuid: 'prefab-1', url: 'db://assets/GameHUD.prefab', name: 'GameHUD' }
      if (channel === 'asset-db' && message === 'open-asset' && argument === 'prefab-1')
        return undefined
      throw new Error(`Unexpected request: ${channel}/${message}`)
    })
    vi.stubGlobal('Editor', { Message: { request } })

    const result = await new PrefabTools().execute('load_prefab', {
      prefabPath: 'db://assets/GameHUD.prefab',
    })

    expect(result).toMatchObject({
      success: true,
      data: {
        uuid: 'prefab-1',
        name: 'GameHUD',
        prefabPath: 'db://assets/GameHUD.prefab',
      },
    })
    expect(request).toHaveBeenNthCalledWith(1, 'asset-db', 'query-asset-info', 'db://assets/GameHUD.prefab')
    expect(request).toHaveBeenNthCalledWith(2, 'asset-db', 'open-asset', 'prefab-1')
    expect(request).not.toHaveBeenCalledWith('scene', 'load-asset', expect.anything())
  })

  it('validates prefab content through asset-db query-path', async () => {
    const prefabPath = path.join(os.tmpdir(), `cocos-mcp-prefab-${Date.now()}.prefab`)
    fs.writeFileSync(prefabPath, JSON.stringify([
      { __type__: 'cc.Prefab', data: { __id__: 1 } },
      { __type__: 'cc.Node', _parent: null },
    ]))
    const request = vi.fn(async (_channel: string, message: string) => {
      if (message === 'query-asset-info')
        return { uuid: 'prefab-1', url: 'db://assets/Test.prefab', name: 'Test' }
      if (message === 'query-path')
        return prefabPath
      throw new Error(`Unexpected message: ${message}`)
    })
    vi.stubGlobal('Editor', { Message: { request } })

    try {
      const result = await new PrefabTools().execute('validate_prefab', { prefabPath: 'db://assets/Test.prefab' })
      expect(result).toMatchObject({ success: true, data: { valid: true, isValid: true, invalid: false } })
      expect(request).not.toHaveBeenCalledWith('asset-db', 'read-asset', expect.anything())
    }
    finally {
      fs.unlinkSync(prefabPath)
    }
  })

  it('uses the registered Cocos create-prefab message without requiring source-node conversion', async () => {
    const request = vi.fn(async (channel: string, message: string) => {
      if (channel === 'scene' && message === 'create-prefab')
        return 'prefab-1'
      if (channel === 'asset-db' && message === 'query-asset-info')
        return { uuid: 'prefab-1', url: 'db://assets/TitleScreen.prefab', name: 'TitleScreen', invalid: false }
      if (channel === 'scene' && message === 'query-nodes-by-asset-uuid')
        return []
      throw new Error(`Unexpected request: ${channel}/${message}`)
    })
    vi.stubGlobal('Editor', { Message: { request } })

    const result = await new PrefabTools().execute('create_prefab', {
      nodeUuid: 'node-1',
      savePath: 'db://assets/TitleScreen.prefab',
      prefabName: 'TitleScreen',
    })

    expect(result).toMatchObject({
      success: true,
      data: { prefabUuid: 'prefab-1', invalid: false, prefabLinked: false, convertedToPrefabInstance: false },
    })
    expect(request).toHaveBeenNthCalledWith(1, 'scene', 'create-prefab', 'node-1', 'db://assets/TitleScreen.prefab')
    expect(request).not.toHaveBeenCalledWith('asset-db', 'create-asset', expect.anything(), expect.anything(), expect.anything())
  })

  it('only reports instantiation success after verifying the prefab association', async () => {
    let created = false
    let linked = false
    const request = vi.fn(async (channel: string, message: string, ...args: unknown[]) => {
      if (channel === 'asset-db' && message === 'query-asset-info')
        return { uuid: 'prefab-1', url: 'db://assets/TitleScreen.prefab', name: 'TitleScreen' }
      if (channel === 'scene' && message === 'create-node') {
        created = true
        return 'instance-1'
      }
      if (channel === 'scene' && message === 'query-node-tree') {
        return created
          ? { uuid: 'scene-1', children: [{ uuid: 'source-1' }, { uuid: 'actual-instance-1' }] }
          : { uuid: 'scene-1', children: [{ uuid: 'source-1' }] }
      }
      if (channel === 'scene' && message === 'query-nodes-by-asset-uuid')
        return linked && args[0] === 'prefab-1' ? ['source-1', 'actual-instance-1'] : ['source-1']
      if (channel === 'scene' && message === 'link-prefab') {
        linked = true
        return true
      }
      throw new Error(`Unexpected request: ${channel}/${message}`)
    })
    vi.stubGlobal('Editor', { Message: { request } })

    const result = await new PrefabTools().execute('instantiate_prefab', {
      prefabPath: 'db://assets/TitleScreen.prefab',
      position: { x: 10, y: 20, z: 0 },
    })

    expect(result).toMatchObject({
      success: true,
      data: { nodeUuid: 'actual-instance-1', createdNodeUuid: 'instance-1', linkTargetNodeUuid: 'actual-instance-1', prefabUuid: 'prefab-1', prefabLinked: true, associationMethod: 'link-prefab' },
    })
    expect(request).toHaveBeenCalledWith('scene', 'create-node', {
      assetUuid: 'prefab-1',
      parent: 'scene-1',
      position: { x: 10, y: 20, z: 0 },
    })
    expect(request).toHaveBeenCalledWith('scene', 'link-prefab', 'actual-instance-1', 'prefab-1')
    expect(request).toHaveBeenCalledWith('scene', 'query-nodes-by-asset-uuid', 'prefab-1')
  })
})
