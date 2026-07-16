import { afterEach, describe, expect, it, vi } from 'vitest'
import { ComponentTools } from './component-tools'

describe('component removal', () => {
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
})
