import type { SceneNodeDump } from '../editor-message'
import { getComponentType } from './component-query'

export interface SceneHierarchyNode {
  uuid?: string
  name?: string
  type?: string
  active?: boolean
  components?: Array<{ type: string, enabled: boolean }>
  childCount: number
  truncated?: boolean
  children: SceneHierarchyNode[]
}

export function buildSceneHierarchy(node: SceneNodeDump, includeComponents: boolean, maxDepth?: number, depth: number = 0): SceneHierarchyNode {
  const children = Array.isArray(node.children) ? node.children : []
  const truncated = maxDepth !== undefined && depth >= maxDepth && children.length > 0
  const result: SceneHierarchyNode = {
    uuid: node.uuid,
    name: node.name,
    type: node.type,
    active: node.active,
    childCount: children.length,
    children: truncated ? [] : children.map(child => buildSceneHierarchy(child, includeComponents, maxDepth, depth + 1)),
  }
  if (truncated) {
    result.truncated = true
  }
  if (includeComponents && Array.isArray(node.__comps__)) {
    result.components = node.__comps__.map(component => ({
      type: getComponentType(component) ?? 'Unknown',
      enabled: typeof component.enabled === 'boolean' ? component.enabled : true,
    }))
  }
  return result
}
