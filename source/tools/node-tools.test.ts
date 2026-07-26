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

  it('applies top-level initial transform aliases after creating a 3D node', async () => {
    const node = {
      uuid: { value: 'node-1' },
      name: { value: 'TestNode' },
      position: { value: { x: 0, y: 0, z: 0 } },
      rotation: { value: { x: 0, y: 0, z: 0 } },
      scale: { value: { x: 1, y: 1, z: 1 } },
      children: [],
      __comps__: [],
    }
    const request = vi.fn(async (_channel: string, message: string, options?: any) => {
      if (message === 'query-node-tree')
        return { uuid: 'scene-1', name: 'Scene', children: [] }
      if (message === 'create-node')
        return 'node-1'
      if (message === 'set-property') {
        if (options.path === 'position')
          node.position.value = options.dump.value
        if (options.path === 'rotation')
          node.rotation.value = options.dump.value
        if (options.path === 'scale')
          node.scale.value = options.dump.value
        return true
      }
      if (message === 'query-node')
        return node
      throw new Error(`Unexpected message: ${message}`)
    })
    vi.stubGlobal('Editor', { Message: { request } })

    await expect(new NodeTools().execute('create_node', {
      name: 'TestNode',
      nodeType: '3DNode',
      position: { x: 4.3, y: 0, z: -5 },
      rotation: { x: 0, y: -16, z: 0 },
      scale: { x: 1, y: 2, z: 3 },
    })).resolves.toMatchObject({ success: true })
    expect(request).toHaveBeenCalledWith('scene', 'set-property', expect.objectContaining({
      uuid: 'node-1',
      path: 'position',
      dump: { value: { x: 4.3, y: 0, z: -5 } },
    }))
  })
})
