import { describe, expect, it } from 'vitest'
import { serializeComponentProperty } from './prefab-property'

describe('prefab component property serializer', () => {
  const context = { nodeUuidToIndex: new Map([['node', 2]]), componentUuidToIndex: new Map([['component', 4]]) }

  it('serializes internal and external references', () => {
    expect(serializeComponentProperty({ type: 'cc.Node', value: { uuid: 'node' } }, context)).toEqual({ __id__: 2 })
    expect(serializeComponentProperty({ type: 'cc.Node', value: { uuid: 'external' } }, context)).toBeNull()
    expect(serializeComponentProperty({ type: 'cc.Label', value: { uuid: 'component' } }, context)).toEqual({ __id__: 4 })
  })

  it('serializes assets, value types, and arrays', () => {
    expect(serializeComponentProperty({ type: 'cc.Prefab', value: { uuid: 'asset' } })).toEqual({ __uuid__: 'asset', __expectedType__: 'cc.Prefab' })
    expect(serializeComponentProperty({ type: 'cc.Color', value: { r: 0, a: 0 } })).toMatchObject({ __type__: 'cc.Color', r: 0, a: 0 })
    expect(serializeComponentProperty({ value: [{ value: 1 }, 2] })).toEqual([1, 2])
  })
})
