import { afterEach, describe, expect, it, vi } from 'vitest'
import { ComponentTools } from './component-tools'

describe('component tools', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('removes a missing script by its component instance uuid', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({
        __comps__: [{ __type__: 'cc.MissingScript', uuid: { value: 'missing-component-1' } }],
      })
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce({ __comps__: [] })
    vi.stubGlobal('Editor', { Message: { request } })

    const result = await new ComponentTools().execute('remove_component', {
      nodeUuid: 'node-1',
      componentType: 'missing-component-1',
    })

    expect(result).toMatchObject({
      success: true,
      data: {
        componentType: 'cc.MissingScript',
        componentUuid: 'missing-component-1',
      },
    })
    expect(request).toHaveBeenNthCalledWith(2, 'scene', 'remove-component', {
      uuid: 'node-1',
      component: 'missing-component-1',
    })
  })

  it('writes MeshRenderer sharedMaterials as a typed material asset array', async () => {
    const materialUuid = 'material-1'
    const component = {
      type: 'cc.MeshRenderer',
      value: {
        sharedMaterials: {
          value: [] as Array<unknown>,
          type: 'cc.Material',
          extends: ['cc.Asset'],
          isArray: true,
        },
      },
    }
    const request = vi.fn(async (channel: string, message: string, ...args: unknown[]) => {
      if (channel === 'scene' && message === 'query-node')
        return { __comps__: [component] }
      if (channel === 'asset-db' && message === 'query-asset-info')
        return { uuid: materialUuid, type: 'cc.Material' }
      if (channel === 'scene' && message === 'set-property') {
        component.value.sharedMaterials.value = [{ value: { uuid: materialUuid }, type: 'cc.Material' }]
        return true
      }
      throw new Error(`Unexpected request: ${channel}/${message} ${JSON.stringify(args)}`)
    })
    vi.stubGlobal('Editor', { Message: { request } })

    const result = await new ComponentTools().execute('set_component_property', {
      nodeUuid: 'node-1',
      componentType: 'cc.MeshRenderer',
      property: 'materials',
      propertyType: 'assetArray',
      value: [materialUuid],
    })

    expect(result).toMatchObject({ success: true })
    expect(request).toHaveBeenCalledWith('scene', 'set-property', {
      uuid: 'node-1',
      path: '__comps__.0.sharedMaterials',
      dump: {
        value: [{ value: { uuid: materialUuid }, type: 'cc.Material' }],
        type: 'cc.Material',
        isArray: true,
      },
    })
  })

  it('writes a declared Vec3 size with Vec3 dump metadata', async () => {
    const component = {
      type: 'cc.BoxCollider',
      value: {
        size: {
          value: { x: 1, y: 1, z: 1 },
          type: 'cc.Vec3',
        },
      },
    }
    const request = vi.fn(async (channel: string, message: string) => {
      if (channel === 'scene' && message === 'query-node')
        return { __comps__: [component] }
      if (channel === 'scene' && message === 'set-property') {
        component.value.size.value = { x: 2, y: 3, z: 4 }
        return true
      }
      throw new Error(`Unexpected request: ${channel}/${message}`)
    })
    vi.stubGlobal('Editor', { Message: { request } })

    const result = await new ComponentTools().execute('set_component_property', {
      nodeUuid: 'node-1',
      componentType: 'cc.BoxCollider',
      property: 'size',
      propertyType: 'size',
      value: { x: 2, y: 3, z: 4 },
    })

    expect(result).toMatchObject({ success: true })
    expect(request).toHaveBeenCalledWith('scene', 'set-property', {
      uuid: 'node-1',
      path: '__comps__.0.size',
      dump: { value: { x: 2, y: 3, z: 4 }, type: 'cc.Vec3' },
    })
  })
})
