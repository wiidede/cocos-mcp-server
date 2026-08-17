import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectTools } from './project-tools'

describe('project asset content contract', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('serializes JSON objects before calling asset-db create-asset', async () => {
    const request = vi.fn(async (_channel: string, message: string, url: string, content: string | null, options: unknown) => {
      expect(message).toBe('create-asset')
      expect(url).toBe('db://assets/levels/level-01.json')
      expect(content).toBe(JSON.stringify({ id: 'level-01', targets: [] }, null, 2))
      expect(options).toEqual({ overwrite: true, rename: false })
      return { uuid: 'asset-uuid', url }
    })
    vi.stubGlobal('Editor', { Message: { request } })

    await expect(new ProjectTools().execute('create_asset', {
      url: 'db://assets/levels/level-01.json',
      content: { id: 'level-01', targets: [] },
      overwrite: true,
    })).resolves.toMatchObject({ success: true, data: { uuid: 'asset-uuid' } })
  })

  it('reports invalid content as a contract error without echoing the value', async () => {
    await expect(new ProjectTools().execute('create_asset', {
      url: 'db://assets/levels/level-01.json',
      content: 42,
    })).resolves.toMatchObject({
      success: false,
      errorCode: 'TOOL_CONTRACT_ERROR',
      metadata: { category: 'contract', attempted: { content: { type: 'number' } } },
    })
  })
})
