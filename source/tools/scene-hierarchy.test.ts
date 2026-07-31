import { describe, expect, it } from 'vitest'
import { buildSceneHierarchy } from './scene-hierarchy'

describe('scene hierarchy builder', () => {
  it('recursively summarizes nodes and optionally components', () => {
    const tree = { uuid: 'root', name: 'Scene', children: [{ uuid: 'child', __comps__: [{ __type__: 'cc.Sprite', enabled: false }] }] }
    expect(buildSceneHierarchy(tree, true)).toMatchObject({ uuid: 'root', children: [{ uuid: 'child', components: [{ type: 'cc.Sprite', enabled: false }] }] })
    expect(buildSceneHierarchy(tree, false).children[0].components).toBeUndefined()
  })

  it('limits hierarchy depth while preserving child counts', () => {
    const tree = {
      uuid: 'root',
      children: [{ uuid: 'child', children: [{ uuid: 'grandchild' }] }],
    }

    expect(buildSceneHierarchy(tree, false, 1)).toMatchObject({
      uuid: 'root',
      childCount: 1,
      children: [{ uuid: 'child', childCount: 1, truncated: true, children: [] }],
    })
  })
})
