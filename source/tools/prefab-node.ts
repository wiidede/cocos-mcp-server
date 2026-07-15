import { asPrefabRecord } from './prefab-format'

export interface EnginePrefabNode extends Record<string, unknown> {
  _name: string
  _children: Array<{ __id__: number }>
  _components: Array<{ __id__: number }>
  _prefab: { __id__: number }
}

function dumpedValue(value: unknown): unknown {
  const record = asPrefabRecord(value)
  return record && Object.hasOwn(record, 'value') ? record.value : value
}

function nodeField(node: Record<string, unknown>, field: string, fallback: unknown): unknown {
  const direct = dumpedValue(node[field])
  if (direct !== undefined && direct !== null)
    return direct
  const nested = asPrefabRecord(node.value)
  const nestedValue = dumpedValue(nested?.[field])
  return nestedValue ?? fallback
}

function vector(value: unknown, fallback: { x: number, y: number, z: number, w?: number }): Record<string, number> {
  const record = asPrefabRecord(value)
  const result: Record<string, number> = {}
  for (const [key, defaultValue] of Object.entries(fallback))
    result[key] = typeof record?.[key] === 'number' ? record[key] : defaultValue
  return result
}

export function extractNodeUuid(nodeData: unknown): string | null {
  const node = asPrefabRecord(nodeData)
  const value = asPrefabRecord(node?.value)
  for (const source of [node?.uuid, value?.uuid, node?.__uuid__, value?.__uuid__, node?.id, value?.id]) {
    if (typeof source === 'string' && source.length > 0)
      return source
  }
  return null
}

export function findNodeInTree(nodeData: unknown, targetUuid: string): Record<string, unknown> | null {
  const node = asPrefabRecord(nodeData)
  if (!node)
    return null
  if (extractNodeUuid(node) === targetUuid)
    return node
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      const found = findNodeInTree(child, targetUuid)
      if (found)
        return found
    }
  }
  return null
}

export function isValidNodeData(nodeData: unknown): boolean {
  const node = asPrefabRecord(nodeData)
  if (!node)
    return false
  const value = asPrefabRecord(node.value)
  return ['uuid', 'name', '__type__'].some(key => Object.hasOwn(node, key) || (value !== null && Object.hasOwn(value, key)))
}

export function extractChildUuid(childReference: unknown): string | null {
  if (typeof childReference === 'string')
    return childReference
  const child = asPrefabRecord(childReference)
  if (!child)
    return null
  if (typeof child.value === 'string')
    return child.value
  const value = asPrefabRecord(child.value)
  return typeof value?.uuid === 'string' ? value.uuid : typeof child.uuid === 'string' ? child.uuid : null
}

export function getChildrenToProcess(nodeData: unknown): Record<string, unknown>[] {
  const children = asPrefabRecord(nodeData)?.children
  return Array.isArray(children) ? children.filter((child): child is Record<string, unknown> => isValidNodeData(child)) : []
}

export function createEngineNode(nodeData: unknown, parentNodeIndex: number | null, nodeName?: string): EnginePrefabNode {
  const node = asPrefabRecord(nodeData) ?? {}
  const position = vector(nodeField(node, 'position', {}), { x: 0, y: 0, z: 0 })
  const rotation = vector(nodeField(node, 'rotation', {}), { x: 0, y: 0, z: 0, w: 1 })
  const scale = vector(nodeField(node, 'scale', {}), { x: 1, y: 1, z: 1 })
  const nameValue = nodeName ?? nodeField(node, 'name', 'Node')
  const layer = nodeField(node, 'layer', 1073741824)
  return {
    __type__: 'cc.Node',
    _name: typeof nameValue === 'string' ? nameValue : 'Node',
    _objFlags: 0,
    __editorExtras__: {},
    _parent: parentNodeIndex === null ? null : { __id__: parentNodeIndex },
    _children: [],
    _active: nodeField(node, 'active', true) !== false,
    _components: [],
    _prefab: { __id__: 0 },
    _lpos: { __type__: 'cc.Vec3', ...position },
    _lrot: { __type__: 'cc.Quat', ...rotation },
    _lscale: { __type__: 'cc.Vec3', ...scale },
    _mobility: 0,
    _layer: typeof layer === 'number' ? layer : 1073741824,
    _euler: { __type__: 'cc.Vec3', x: 0, y: 0, z: 0 },
    _id: '',
  }
}

export function createMinimalPrefabNode(nodeData: unknown, nodeName?: string): EnginePrefabNode {
  const node = createEngineNode(nodeData, null, nodeName)
  node._objFlags = 0
  delete node.__editorExtras__
  node._prefab = { __id__: 2 }
  if (node._layer === 1073741824)
    node._layer = 33554432
  return node
}
