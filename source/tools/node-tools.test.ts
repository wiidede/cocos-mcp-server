import { afterEach, describe, expect, it, vi } from 'vitest'
import { NodeTools } from './node-tools'

describe('node creation options', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses the supported type option instead of treating nodeType as a component', async () => {
    const request = vi.fn(async (_channel: string, message: string) => {
      if (message === 'query-node-tree')
        return { uuid: 'scene-1', name: 'Scene', children: [] }
      if (message === 'create-node')
        return 'node-1'
      if (message === 'query-node')
        return { uuid: { value: 'node-1' }, name: { value: 'TestNode' }, children: [], __comps__: [] }
      throw new Error(`Unexpected message: ${message}`)
    })
    vi.stubGlobal('Editor', { Message: { request } })

    await expect(new NodeTools().execute('create_node', {
      name: 'TestNode',
      nodeType: '2DNode',
    })).resolves.toMatchObject({ success: true, data: { uuid: 'node-1' } })
    expect(request).toHaveBeenCalledWith('scene', 'create-node', {
      name: 'TestNode',
      parent: 'scene-1',
      type: '2DNode',
    })
  })
})
