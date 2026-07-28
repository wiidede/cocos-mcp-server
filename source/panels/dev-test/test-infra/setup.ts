/**
 * Dev Test setup and shared lifecycle.
 *
 * A runAll session owns one temporary Scene. Tests register resources they
 * create; the session performs best-effort cleanup in a finally block.
 */

import { callTool } from './tool-client'

const TEST_DIR = 'db://assets/__dev_test__'
const TEST_SCENE_PATH = `${TEST_DIR}/TestScene.scene`

export interface TestContext {
  callTool: (name: string, args: any) => Promise<any>
  step: (name: string, ok: boolean, message?: string) => void
  assert: (cond: any, message: string) => void
  scenePath: string
  nodeUuid: string
  trackNode: (uuid: string) => void
  trackAsset: (url: string) => void
}

export interface TestSession {
  scenePath: string
  trackedNodeUuids: Set<string>
  trackedAssetUrls: Set<string>
  ensureSceneContext: () => Promise<void>
  ensurePrefabContext: (prefabPath: string) => Promise<void>
  exitPrefabContext: () => Promise<void>
  createContext: (step: TestContext['step'], assert: TestContext['assert']) => TestContext
  cleanup: () => Promise<void>
}

export async function createTestSession(): Promise<TestSession> {
  const trackedNodeUuids = new Set<string>()
  const trackedAssetUrls = new Set<string>()
  let scenePrepared = false
  let sceneOpen = false

  const ensureSceneContext = async () => {
    if (scenePrepared) {
      if (!sceneOpen)
        await Editor.Message.request('asset-db', 'open-asset', TEST_SCENE_PATH)
      await waitForSceneReady()
      sceneOpen = true
      return
    }
    const createResp = await callTool('scene_management', {
      action: 'create',
      savePath: TEST_SCENE_PATH,
      autoCreateCanvas: false,
    })
    if (!createResp || createResp.success === false) {
      throw new Error(`setupTestScene: 创建场景失败: ${createResp?.error ?? JSON.stringify(createResp)}`)
    }

    await waitForSceneReady()
    scenePrepared = true
    sceneOpen = true
  }

  const exitPrefabContext = async () => {
    // Cocos 3.8 does not expose a stable public close-prefab message in this
    // extension. Opening the owned Scene is the registered, supported route
    // that restores normal Scene context after asset-db/open-asset.
    await Editor.Message.request('asset-db', 'open-asset', TEST_SCENE_PATH)
    await waitForSceneReady()
    sceneOpen = true
  }

  const ensurePrefabContext = async (prefabPath: string) => {
    await Editor.Message.request('asset-db', 'open-asset', prefabPath)
    sceneOpen = false
  }

  const createContext = (step: TestContext['step'], assert: TestContext['assert']): TestContext => ({
    callTool,
    step,
    assert,
    scenePath: TEST_SCENE_PATH,
    nodeUuid: '',
    trackNode: (uuid: string) => {
      if (uuid)
        trackedNodeUuids.add(uuid)
    },
    trackAsset: (url: string) => {
      if (url)
        trackedAssetUrls.add(url)
    },
  })

  const cleanup = async () => {
    await exitPrefabContext().catch(() => undefined)

    for (const uuid of trackedNodeUuids) {
      await callTool('node_lifecycle', { action: 'delete', uuid }).catch(() => undefined)
    }
    for (const url of trackedAssetUrls) {
      await callTool('asset_manage', { action: 'delete', url }).catch(() => undefined)
    }

    const sceneUuid = await getAssetUuidByPath(TEST_SCENE_PATH)
    if (sceneUuid)
      await Editor.Message.request('asset-db', 'delete-asset', sceneUuid).catch(() => undefined)
    const dirUuid = await getAssetUuidByPath(TEST_DIR)
    if (dirUuid)
      await Editor.Message.request('asset-db', 'delete-asset', dirUuid).catch(() => undefined)
  }

  await ensureSceneContext()
  return {
    scenePath: TEST_SCENE_PATH,
    trackedNodeUuids,
    trackedAssetUrls,
    ensureSceneContext,
    ensurePrefabContext,
    exitPrefabContext,
    createContext,
    cleanup,
  }
}

/** Compatibility helper for callers that still need a one-test setup. */
export async function setupTestScene(): Promise<TestContext> {
  const session = await createTestSession()
  const step = () => undefined
  const assert: TestContext['assert'] = (cond, message) => {
    if (!cond)
      throw new Error(`Assertion failed: ${message}`)
  }
  return session.createContext(step, assert)
}

export async function teardownTestScene(): Promise<void> {
  // Kept for compatibility; Runner uses TestSession so cleanup also covers
  // nodes and assets registered by tests.
  const sceneUuid = await getAssetUuidByPath(TEST_SCENE_PATH)
  if (sceneUuid)
    await Editor.Message.request('asset-db', 'delete-asset', sceneUuid).catch(() => undefined)
}

async function waitForSceneReady(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    try {
      const response: any = await callTool('scene_query', { action: 'get_info' })
      if (response?.data?.ready === true)
        return
    }
    catch {
      // wait for the editor
    }
    await sleep(150)
  }
  throw new Error('场景在 3s 内未就绪')
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function getAssetUuidByPath(dbPath: string): Promise<string | null> {
  try {
    const info: any = await Editor.Message.request('asset-db', 'query-asset-info', dbPath)
    if (info?.uuid)
      return info.uuid
    if (info?.asset?.uuid)
      return info.asset.uuid
  }
  catch {
    // ignore cleanup errors
  }
  return null
}
