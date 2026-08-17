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

export interface SceneHierarchyBuildResult {
  tree: SceneHierarchyNode
  returnedNodes: number
  truncated: boolean
}

export function buildSceneHierarchy(
  node: SceneNodeDump,
  includeComponents: boolean,
  maxDepth?: number,
  maxNodes: number = Number.POSITIVE_INFINITY,
): SceneHierarchyNode {
  return buildSceneHierarchyResult(node, includeComponents, maxDepth, maxNodes).tree
}

export function buildSceneHierarchyResult(
  node: SceneNodeDump,
  includeComponents: boolean,
  maxDepth?: number,
  maxNodes: number = Number.POSITIVE_INFINITY,
): SceneHierarchyBuildResult {
  const safeMaxNodes = Number.isFinite(maxNodes) ? Math.max(1, Math.floor(maxNodes)) : Number.POSITIVE_INFINITY
  let returnedNodes = 0
  let truncated = false

  const build = (current: SceneNodeDump, depth: number): SceneHierarchyNode => {
    returnedNodes++
    const children = Array.isArray(current.children) ? current.children : []
    const result: SceneHierarchyNode = {
      uuid: current.uuid,
      name: current.name,
      type: current.type,
      active: current.active,
      childCount: children.length,
      children: [],
    }

    if (includeComponents && Array.isArray(current.__comps__)) {
      result.components = current.__comps__.map(component => ({
        type: getComponentType(component) ?? 'Unknown',
        enabled: typeof component.enabled === 'boolean' ? component.enabled : true,
      }))
    }

    if (children.length === 0) {
      return result
    }

    if (maxDepth !== undefined && depth >= maxDepth) {
      result.truncated = true
      truncated = true
      return result
    }

    for (const child of children) {
      if (returnedNodes >= safeMaxNodes) {
        result.truncated = true
        truncated = true
        break
      }
      result.children.push(build(child, depth + 1))
    }

    return result
  }

  const tree = build(node, 0)
  return { tree, returnedNodes, truncated }
}
