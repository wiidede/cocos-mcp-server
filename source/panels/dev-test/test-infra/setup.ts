/**
 * Dev Test Setup
 *
 * 创建/清理一个临时测试场景，避免污染用户项目。
 * 路径固定为 db://assets/__dev_test__/TestScene.scene。
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
}

export async function setupTestScene(): Promise<TestContext> {
  const steps: { name: string, ok: boolean, message?: string }[] = []
  const step = (name: string, ok: boolean, message?: string) => {
    steps.push({ name, ok, message })
  }
  const assert: TestContext['assert'] = (cond: any, message: string) => {
    if (!cond) {
      throw new Error(`Assertion failed: ${message}`)
    }
  }

  // 不主动 close 当前场景：在 general edit mode 下会被 Cocos 拒绝（控制台报错）。
  // create-scene 会通过 editor API 强制覆盖打开，不依赖之前场景状态。

  // 1) 创建新的空场景（强制 autoCreateCanvas=false，测试需要可控环境）
  const createResp = await callTool('scene_management', {
    action: 'create',
    savePath: TEST_SCENE_PATH,
    autoCreateCanvas: false,
  })
  if (!createResp || createResp.success === false) {
    throw new Error(`setupTestScene: 创建场景失败: ${createResp?.error ?? JSON.stringify(createResp)}`)
  }
  step('create test scene', true, TEST_SCENE_PATH)

  // 2) 等待场景就绪
  let ready = false
  for (let i = 0; i < 20; i++) {
    try {
      const resp: any = await callTool('scene_query', { action: 'get_info' })
      // sceneAdvanced_query_scene_info 返回 { success, data: { ready, dirty, ... } }
      if (resp?.data?.ready === true) {
        ready = true
        break
      }
    }
    catch {
      // ignore
    }
    await sleep(150)
  }
  assert(ready, '场景在 3s 内未就绪')
  step('scene ready', true)

  return { callTool, step, assert, scenePath: TEST_SCENE_PATH, nodeUuid: '' }
}

export async function teardownTestScene(): Promise<void> {
  try {
    // 不主动 close：general edit mode 下 Cocos 会拒绝并控制台报错。
    // 测试场景的 UUID 已被删除，下次重新 create 时 editor API 会强制覆盖打开。
    // 删除测试场景文件
    try {
      const sceneUuid = await getAssetUuidByPath(TEST_SCENE_PATH)
      if (sceneUuid) {
        await Editor.Message.request('asset-db', 'delete-asset', sceneUuid)
      }
    }
    catch {
      // ignore
    }
    // 删除测试目录
    try {
      const dirUuid = await getAssetUuidByPath(TEST_DIR)
      if (dirUuid) {
        await Editor.Message.request('asset-db', 'delete-asset', dirUuid)
      }
    }
    catch {
      // ignore
    }
  }
  catch {
    // ignore teardown errors
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function getAssetUuidByPath(dbPath: string): Promise<string | null> {
  try {
    const info: any = await Editor.Message.request('asset-db', 'query-asset-info', dbPath)
    if (info && info.uuid)
      return info.uuid
    if (info && info.asset && info.asset.uuid)
      return info.asset.uuid
  }
  catch {
    // ignore
  }
  return null
}
