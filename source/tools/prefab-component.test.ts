import { describe, expect, it } from 'vitest'
import { createPrefabComponent, createStandardPrefabComponent, extractPrefabComponents } from './prefab-component'

describe('prefab component serializer', () => {
  it('extracts the first supported component collection', () => {
    expect(extractPrefabComponents({ value: { __comps__: [{ __type__: 'cc.Sprite' }, {}] } })).toEqual([{ __type__: 'cc.Sprite' }])
  })

  it('serializes known and custom components', () => {
    expect(createStandardPrefabComponent({ __type__: 'cc.UITransform', contentSize: { value: { width: 0, height: 20 } } }, 1, 2)).toMatchObject({ __type__: 'cc.UITransform', node: { __id__: 1 }, _contentSize: { width: 0, height: 20 } })
    expect(createStandardPrefabComponent({ type: 'Player', enabled: false, fontSize: 16 }, 3, 4)).toMatchObject({ __type__: 'Player', _enabled: false, _fontSize: 16 })
    expect(createStandardPrefabComponent({}, 1, 2)).toBeNull()
  })

  it('serializes the main component dump format', () => {
    expect(createPrefabComponent({ type: 'cc.Sprite', properties: { _type: { value: 2 } } }, 1)).toMatchObject({ __type__: 'cc.Sprite', node: { __id__: 1 }, _type: 2 })
    expect(createPrefabComponent({ type: 'Player', properties: { speed: { value: 5 } } }, 2)).toMatchObject({ __type__: 'Player', speed: 5 })
  })
})
