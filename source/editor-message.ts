export interface SceneComponentDump {
  __type__?: string
  type?: string
  cid?: string
  name?: string
  uuid?: string | { value?: string }
  enabled?: boolean
  value?: {
    name?: string
    uuid?: string | { value?: string }
    [key: string]: unknown
  }
  [key: string]: unknown
}

export interface SceneNodeDump {
  uuid?: string
  name?: string
  type?: string
  active?: boolean
  parent?: SceneNodeDump | null
  children?: SceneNodeDump[]
  __comps__?: SceneComponentDump[]
  [key: string]: unknown
}

export interface ScenePropertyDump<T = unknown> {
  value?: T
  type?: string
  [key: string]: unknown
}

export interface SceneNodePropertyDump {
  uuid?: ScenePropertyDump<string>
  name?: ScenePropertyDump<string>
  active?: ScenePropertyDump<boolean>
  position?: ScenePropertyDump<{ x: number, y: number, z: number }>
  rotation?: ScenePropertyDump<{ x: number, y: number, z: number }>
  scale?: ScenePropertyDump<{ x: number, y: number, z: number }>
  parent?: ScenePropertyDump<{ uuid?: string }>
  layer?: ScenePropertyDump<number>
  mobility?: ScenePropertyDump<number>
  children?: string[]
  __comps__?: SceneComponentDump[]
  [key: string]: unknown
}

export interface CurrentSceneInfo {
  uuid?: string
  url?: string
  name?: string
}

export interface AssetDbAssetInfo {
  uuid: string
  url: string
  name: string
  type?: string
  [key: string]: unknown
}

interface SceneRequestMap {
  'query-node': { args: [uuid: string], result: SceneNodePropertyDump }
  'query-node-tree': { args: [], result: SceneNodeDump }
  'query-is-ready': { args: [], result: boolean }
  'query-dirty': { args: [], result: boolean }
  'query-current-scene': { args: [], result: CurrentSceneInfo | null }
  'set-property': { args: [options: { uuid: string, path: string, dump: unknown }], result: unknown }
}

interface AssetDbRequestMap {
  'query-asset-info': { args: [urlOrUuid: string], result: AssetDbAssetInfo | null }
  'query-assets': { args: [options: { pattern: string }], result: AssetDbAssetInfo[] }
  'query-uuid': { args: [url: string], result: string | null }
}

type EditorRequest = (channel: string, message: string, ...args: unknown[]) => Promise<unknown>

function request(channel: string, message: string, args: unknown[]): Promise<unknown> {
  const requestEditor = Editor.Message.request as unknown as EditorRequest
  return requestEditor(channel, message, ...args)
}

export function requestEditor(channel: string, message: string, ...args: unknown[]): Promise<unknown> {
  return request(channel, message, args)
}

export async function requestScene<K extends keyof SceneRequestMap>(
  message: K,
  ...args: SceneRequestMap[K]['args']
): Promise<SceneRequestMap[K]['result']> {
  return request('scene', message, args) as Promise<SceneRequestMap[K]['result']>
}

export async function requestAssetDb<K extends keyof AssetDbRequestMap>(
  message: K,
  ...args: AssetDbRequestMap[K]['args']
): Promise<AssetDbRequestMap[K]['result']> {
  return request('asset-db', message, args) as Promise<AssetDbRequestMap[K]['result']>
}
