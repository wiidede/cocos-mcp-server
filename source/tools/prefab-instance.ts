import type { SceneNodeDump } from '../editor-message'
import { requestScene } from '../editor-message'

export interface PrefabInstanceLinkDelta {
  allNodeUuids: string[]
  newNodeUuids: string[]
}

export function collectSceneNodeUuids(node: SceneNodeDump | null): Set<string> {
  const uuids = new Set<string>()
  const visit = (current: SceneNodeDump): void => {
    if (typeof current.uuid === 'string')
      uuids.add(current.uuid)
    for (const child of current.children ?? [])
      visit(child)
  }
  if (node)
    visit(node)
  return uuids
}

export async function findNewPrefabInstanceLinks(assetUuid: string, previousNodeUuids: ReadonlySet<string>, attempts: number = 3): Promise<PrefabInstanceLinkDelta> {
  let allNodeUuids: string[] = []
  for (let attempt = 0; attempt < attempts; attempt++) {
    allNodeUuids = await requestScene('query-nodes-by-asset-uuid', assetUuid).catch((): string[] => [])
    const newNodeUuids = allNodeUuids.filter(uuid => !previousNodeUuids.has(uuid))
    if (newNodeUuids.length > 0)
      return { allNodeUuids, newNodeUuids }
    if (attempt < attempts - 1)
      await new Promise(resolve => setTimeout(resolve, 100))
  }
  return { allNodeUuids, newNodeUuids: [] }
}

export async function verifyPrefabInstanceLink(nodeUuid: string, assetUuid: string, attempts: number = 3): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const nodeUuids = await requestScene('query-nodes-by-asset-uuid', assetUuid).catch((): string[] => [])
    if (nodeUuids.includes(nodeUuid))
      return true
    if (attempt < attempts - 1)
      await new Promise(resolve => setTimeout(resolve, 100))
  }
  return false
}
