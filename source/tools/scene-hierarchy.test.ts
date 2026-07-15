import { describe, expect, it } from 'vitest'
import { buildSceneHierarchy } from './scene-hierarchy'

describe('scene hierarchy builder', () => {
  it('recursively summarizes nodes and optionally components', () => {
    const tree = { uuid: 'root', name: 'Scene', children: [{ uuid: 'child', __comps__: [{ __type__: 'cc.Sprite', enabled: false }] }] }
    expect(buildSceneHierarchy(tree, true)).toMatchObject({ uuid: 'root', children: [{ uuid: 'child', components: [{ type: 'cc.Sprite', enabled: false }] }] })
    expect(buildSceneHierarchy(tree, false).children[0].components).toBeUndefined()
  })
})
