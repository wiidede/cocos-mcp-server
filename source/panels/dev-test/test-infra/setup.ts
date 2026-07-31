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
  ensurePrefabContext: (prefabPath: string) => Promise<void>
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
  let currentAssetPath: string | null = null

  const saveCurrentAssetIfDirty = async (): Promise<void> => {
    if (!currentAssetPath)
      return

    const dirty = await Editor.Message.request('scene', 'query-dirty')
    if (dirty !== true)
      return

    await Editor.Message.request('scene', 'save-scene')
    const stillDirty = await Editor.Message.request('scene', 'query-dirty')
    if (stillDirty === true)
      throw new Error(`测试资源 '${currentAssetPath}' 保存后仍处于 modified 状态`)
  }

  const ensureSceneContext = async () => {
    if (scenePrepared) {
      if (!sceneOpen) {
        await saveCurrentAssetIfDirty()
        await Editor.Message.request('asset-db', 'open-asset', TEST_SCENE_PATH)
        currentAssetPath = TEST_SCENE_PATH
      }
      await waitForSceneReady()
      sceneOpen = true
      return
    }
    const createResp = await callTool('scene_lifecycle', {
      action: 'create',
      savePath: TEST_SCENE_PATH,
      autoCreateCanvas: false,
    })
    if (!createResp || createResp.success === false) {
      throw new Error(`setupTestScene: 创建场景失败: ${createResp?.error ?? JSON.stringify(createResp)}`)
    }

    // The asset was created directly at TEST_SCENE_PATH, so opening it is not
    // a Save As operation and does not require a save-location dialog.
    await Editor.Message.request('asset-db', 'open-asset', TEST_SCENE_PATH)
    await waitForSceneReady()
    scenePrepared = true
    sceneOpen = true
    currentAssetPath = TEST_SCENE_PATH
  }

  const exitPrefabContext = async () => {
    // Cocos 3.8 does not expose a stable public close-prefab message in this
    // extension. Save the known test asset before opening the owned Scene;
    // this uses save-scene, never save-as-scene, so no location dialog is
    // required.
    await saveCurrentAssetIfDirty()
    await Editor.Message.request('asset-db', 'open-asset', TEST_SCENE_PATH)
    await waitForSceneReady()
    sceneOpen = true
    currentAssetPath = TEST_SCENE_PATH
  }

  const ensurePrefabContext = async (prefabPath: string) => {
    await saveCurrentAssetIfDirty()
    await Editor.Message.request('asset-db', 'open-asset', prefabPath)
    sceneOpen = false
    currentAssetPath = prefabPath
  }

  const createContext = (step: TestContext['step'], assert: TestContext['assert']): TestContext => ({
    callTool,
    step,
    assert,
    scenePath: TEST_SCENE_PATH,
    nodeUuid: '',
    ensurePrefabContext,
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
    // First leave Prefab mode while the current asset is still known and can
    // be saved. Do not save before deleting tracked Scene nodes: those
    // deletions make TestScene dirty again.
    await exitPrefabContext().catch(() => undefined)

    for (const uuid of trackedNodeUuids) {
      await callTool('node_lifecycle', { action: 'delete', uuid }).catch(() => undefined)
    }

    // Node cleanup changes the Scene, so this save must happen after all node
    // mutations and immediately before closing the editor context.
    await saveCurrentAssetIfDirty().catch(() => undefined)

    // Do not delete the currently open Scene directly. Cocos may interpret
    // asset-db/delete-asset on the active scene as closing dirty scene data
    // and show a modal confirmation, even after save-scene completed.
    await Editor.Message.request('scene', 'close-scene').catch(() => undefined)
    sceneOpen = false
    currentAssetPath = null

    for (const url of trackedAssetUrls) {
      await callTool('asset_lifecycle', { action: 'delete', url }).catch(() => undefined)
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
