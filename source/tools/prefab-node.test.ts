import { describe, expect, it } from 'vitest'
import { createEngineNode, createMinimalPrefabNode, extractChildUuid, extractNodeUuid, findNodeInTree, getChildrenToProcess, isValidNodeData } from './prefab-node'

describe('prefab node helpers', () => {
  const tree = { uuid: 'root', children: [{ value: { uuid: 'child', name: 'Child' } }] }

  it('finds nested nodes using direct and dumped UUIDs', () => {
    expect(findNodeInTree(tree, 'child')).toEqual(tree.children[0])
    expect(findNodeInTree(tree, 'missing')).toBeNull()
    expect(extractNodeUuid({ value: { id: 'legacy' } })).toBe('legacy')
  })

  it('validates nodes and normalizes child references', () => {
    expect(isValidNodeData({ value: { name: 'Node' } })).toBe(true)
    expect(isValidNodeData({})).toBe(false)
    expect(extractChildUuid('direct')).toBe('direct')
    expect(extractChildUuid({ value: { uuid: 'nested' } })).toBe('nested')
    expect(extractChildUuid({ __id__: 1 })).toBeNull()
    expect(getChildrenToProcess(tree)).toEqual(tree.children)
  })

  it('builds engine and minimal prefab nodes from inspector dumps', () => {
    expect(createEngineNode({ name: { value: 'Player' }, position: { value: { x: 3 } } }, 1)).toMatchObject({ _name: 'Player', _parent: { __id__: 1 }, _lpos: { x: 3, y: 0, z: 0 } })
    expect(createMinimalPrefabNode({}, 'Root')).toMatchObject({ _name: 'Root', _parent: null, _prefab: { __id__: 2 }, _layer: 33554432 })
  })
})
