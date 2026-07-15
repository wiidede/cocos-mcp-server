import type { SceneNodeDump } from '../editor-message'
import { getComponentType } from './component-query'

export interface SceneHierarchyNode {
  uuid?: string
  name?: string
  type?: string
  active?: boolean
  components?: Array<{ type: string, enabled: boolean }>
  children: SceneHierarchyNode[]
}

export function buildSceneHierarchy(node: SceneNodeDump, includeComponents: boolean): SceneHierarchyNode {
  const result: SceneHierarchyNode = {
    uuid: node.uuid,
    name: node.name,
    type: node.type,
    active: node.active,
    children: Array.isArray(node.children) ? node.children.map(child => buildSceneHierarchy(child, includeComponents)) : [],
  }
  if (includeComponents && Array.isArray(node.__comps__)) {
    result.components = node.__comps__.map(component => ({
      type: getComponentType(component) ?? 'Unknown',
      enabled: typeof component.enabled === 'boolean' ? component.enabled : true,
    }))
  }
  return result
}
