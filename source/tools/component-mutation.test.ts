import { describe, expect, it } from 'vitest'
import { getNodePropertyRedirect, isComponentReference, unwrapComponentReference, unwrapPropertyDumpValue, verifyComponentPropertyValue } from './component-mutation'

describe('component mutation rules', () => {
  it('redirects node transform properties', () => {
    expect(getNodePropertyRedirect({ nodeUuid: 'node-1', componentType: 'cc.Node', property: 'position', value: { x: 1 } })).toMatchObject({
      success: false,
      error: 'Property \'position\' is a node transform property, not a component property',
      instruction: expect.stringContaining('set_node_transform'),
    })
  })

  it('does not redirect component properties', () => {
    expect(getNodePropertyRedirect({ nodeUuid: 'node-1', componentType: 'cc.Sprite', property: 'spriteFrame', value: 'asset-1' })).toBeNull()
  })

  it('unwraps nested component references', () => {
    expect(unwrapComponentReference({ value: { uuid: 'component-1' } })).toBe('component-1')
    expect(unwrapComponentReference({ __id__: 7 })).toBe('__id__:7')
    expect(isComponentReference({ __uuid__: 'asset-1' })).toBe(true)
  })

  it('verifies dump values and compatible references', () => {
    expect(unwrapPropertyDumpValue({ value: 42, type: 'Number' })).toBe(42)
    expect(verifyComponentPropertyValue({ value: { uuid: 'component-1' } }, { uuid: 'component-1' }, null)).toBe(true)
    expect(verifyComponentPropertyValue('42', 42, 0)).toBe(true)
    expect(verifyComponentPropertyValue({ x: 1 }, { x: 2 }, null)).toBe(false)
  })
})
