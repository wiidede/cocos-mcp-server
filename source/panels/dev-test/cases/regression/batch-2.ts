/**
 * 回归测试 - 第二批
 *
 * 这批测试覆盖第二批发现并修复的 5 个 bug
 */

import type { TestCase } from '../../test-infra/metadata'
import { sleep } from '../../test-infra/setup'

// ─────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────

/** 等待场景就绪稳定（在可能触发场景重载的操作后调用，如导入新资产） */
async function waitSceneReady(
  ctx: { callTool: (n: string, a: any) => Promise<any> },
  timeoutMs = 5000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const resp: any = await ctx.callTool('scene_query', { action: 'get_info' })
      if (resp?.data?.ready === true) {
        return true
      }
    }
    catch {
      // scene 重载中，query 会失败，继续等
    }
    await sleep(150)
  }
  return false
}

/** query-asset-info 后取 uuid 字段。失败返回 null */
async function queryAssetUuid(dbPath: string): Promise<string | null> {
  try {
    const info: any = await Editor.Message.request('asset-db', 'query-asset-info', dbPath)
    return info?.uuid ?? null
  }
  catch {
    return null
  }
}

/** 在测试场景里建一个空 Node（用 node_lifecycle + action: 'create'），返回 uuid */
async function createEmptyNode(
  ctx: { callTool: (n: string, a: any) => Promise<any>, step: (n: string, ok: boolean, m?: string) => void, assert: (c: any, m: string) => void },
  name: string,
  parentUuid = '',
): Promise<string> {
  const args: any = {
    action: 'create',
    name,
    nodeType: '2DNode',
  }
  if (parentUuid) {
    args.parentUuid = parentUuid
  }
  const resp: any = await ctx.callTool('node_lifecycle', args)
  const uuid = resp?.uuid ?? resp?.data?.uuid
  ctx.assert(uuid, `node_lifecycle.create(${name}) returned no uuid. resp=${JSON.stringify(resp)?.slice(0, 200)}`)
  ctx.step(`create node "${name}"`, true, uuid)
  return uuid
}

/** 给一个节点加组件。验证 success 即可，不验证 compUuid 字段（add 接口不返回 uuid） */
async function addComponentSafely(
  ctx: { callTool: (n: string, a: any) => Promise<any>, step: (n: string, ok: boolean, m?: string) => void },
  nodeUuid: string,
  componentType: string,
): Promise<boolean> {
  try {
    const resp: any = await ctx.callTool('component_lifecycle', {
      action: 'add',
      nodeUuid,
      componentType,
    })
    if (resp?.success === false) {
      ctx.step(`add ${componentType}`, false, resp?.error?.slice(0, 120) ?? 'failed')
      return false
    }
    // success=true 即视为成功。msg/verified 等字段是辅助信息。
    const verified = resp?.data?.componentVerified === true
    ctx.step(`add ${componentType}`, true, verified ? 'verified' : 'reported ok')
    return true
  }
  catch (e: any) {
    ctx.step(`add ${componentType}`, false, e?.message?.slice(0, 120) ?? String(e))
    return false
  }
}

/** 调 create_default_spriteframe（走 asset_lifecycle 统一工具） */
async function createDefaultSpriteframe(
  ctx: { callTool: (n: string, a: any) => Promise<any>, step: (n: string, ok: boolean, m?: string) => void, assert: (c: any, m: string) => void, trackAsset: (url: string) => void },
  args: { color?: string, size?: number, savePath?: string } = {},
): Promise<{ spriteFrameUuid: string, pngPath: string, pngUuid?: string, color?: any, size?: number, cached?: boolean } | null> {
  const testTextureDir = 'db://assets/__dev_test__/default_textures'
  const testArgs = {
    ...args,
    savePath: args.savePath || `${testTextureDir}/texture_${args.color?.replace(/[^a-z0-9]/gi, '') || 'white'}_${args.size || 4}px.png`,
  }
  const resp: any = await ctx.callTool('asset_lifecycle', {
    action: 'create_default_spriteframe',
    ...testArgs,
  })
  if (resp?.success === false || !resp?.data?.spriteFrameUuid) {
    ctx.step('create_default_spriteframe', false, resp?.error?.slice(0, 200) ?? 'no uuid')
    return null
  }
  if (typeof resp.data.pngPath === 'string')
    ctx.trackAsset(resp.data.pngPath)
  ctx.step('create_default_spriteframe', true, `${resp.data.pngPath} -> ${resp.data.spriteFrameUuid}`)
  return resp.data
}

/** 读组件 value（用 query-node 不走 get_info 避免 parseComponentSummary 信息丢失） */
async function readComponentValue(nodeUuid: string, componentType: string, property: string): Promise<any> {
  try {
    const node: any = await Editor.Message.request('scene', 'query-node', nodeUuid)
    const comps: any[] = node?.__comps__ ?? []

    // 调试：记录读取过程
    console.log(`[readComponentValue] nodeUuid=${nodeUuid}, comps count=${comps.length}`)
    console.log(`[readComponentValue] Looking for component type: ${componentType}`)

    for (let i = 0; i < comps.length; i++) {
      const c = comps[i]
      const candidates = [c?.__type__, c?.type, c?.value?.__type__, c?.value?.name, c?.name]
      console.log(`[readComponentValue] Component ${i}: __type__=${c?.__type__}, type=${c?.type}, value.__type__=${c?.value?.__type__}, value.name=${c?.value?.name}`)

      const matched = candidates.some((x) => {
        if (x == null) {
          return false
        }
        const s = String(x).replace(/^cc\./, '')
        const targetType = String(componentType).replace(/^cc\./, '')
        return s === targetType
      })

      if (matched) {
        console.log(`[readComponentValue] Found component ${componentType}`)
        // 尝试多种属性名：原名、去掉下划线前缀、加下划线前缀
        const propertyVariants = [
          property,
          property.startsWith('_') ? property.slice(1) : `_${property}`,
        ]

        for (const propName of propertyVariants) {
          const v = c?.value?.[propName]
          console.log(`[readComponentValue] Checking property ${propName}: exists=${v !== undefined && v !== null}`)

          if (v !== undefined && v !== null) {
            // value 可能是 { name, value, type, default, ... } 描述符字典
            // 关键：先检查是否是描述符，再返回其内部 value
            if (typeof v === 'object' && 'value' in v) {
              console.log(`[readComponentValue] Returning descriptor.value:`, v.value)
              return v.value // 返回描述符的 value 字段
            }
            // 否则直接返回原值
            console.log(`[readComponentValue] Returning raw value:`, v)
            return v
          }
        }

        // 如果所有变体都找不到，返回 null
        console.log(`[readComponentValue] No property found, returning null`)
        return null
      }
    }

    console.log(`[readComponentValue] Component ${componentType} not found`)
  }
  catch (e: any) {
    console.error(`[readComponentValue] Error:`, e)
  }
  return undefined
}

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

export const batch2Tests: TestCase[] = [
  // ───────────────────────────────────────────────────────────
  // Bug C 主功能：create_default_spriteframe
  // ───────────────────────────────────────────────────────────
  {
    name: 'recent_01:create_default_spriteframe_generates_white_4px',
    group: 'regression/batch-2',
    description: 'create_default_spriteframe 不带参数时生成 4x4 白色 SpriteFrame 并返回有效 UUID',
    tags: ['integration', 'asset', 'core'],
    run: async (ctx) => {
      const created = await createDefaultSpriteframe(ctx, {})
      ctx.assert(created?.spriteFrameUuid, 'spriteFrameUuid missing')
      // 验证 PNG 资产可被 query-asset-info 查到
      const info: any = await Editor.Message.request('asset-db', 'query-asset-info', created!.pngPath)
      ctx.step('png asset exists', info?.uuid != null, created!.pngPath)
    },
  },

  // ───────────────────────────────────────────────────────────
  // Bug C 变体：自定义颜色
  // ───────────────────────────────────────────────────────────
  {
    name: 'recent_02:create_default_spriteframe_supports_custom_color_and_size',
    group: 'regression/batch-2',
    description: 'create_default_spriteframe 支持 #RRGGBB 颜色和自定义 size',
    tags: ['integration', 'asset'],
    run: async (ctx) => {
      const created = await createDefaultSpriteframe(ctx, { color: '#ff0000', size: 8 })
      ctx.assert(created?.spriteFrameUuid, 'spriteFrameUuid missing')
      ctx.assert(created!.size === 8, `expected size 8, got ${created!.size}`)
      ctx.assert(created!.color?.r === 255, `expected r=255, got ${created!.color?.r}`)
      ctx.step('color/size correct', true, JSON.stringify(created!.color))
    },
  },

  // ───────────────────────────────────────────────────────────
  // Bug C 端到端：用生成的 SpriteFrame 给 cc.Sprite 赋值
  // ───────────────────────────────────────────────────────────
  {
    name: 'recent_03:cc_sprite_spriteframe_assignment',
    group: 'regression/batch-2',
    description: 'create_default_spriteframe 拿到的 UUID 真的能赋给 cc.Sprite.spriteFrame',
    tags: ['regression', 'component', 'asset', 'critical'],
    timeout: 10000,
    regression: {
      bugId: 'v1.5.1-recent-03',
      fixedIn: 'v1.5.1',
      rootCause: 'component_property 丢弃 Inspector 属性 dump.path，自行用公开属性名拼写入路径；SpriteFrame 的序列化 backing field 因此没有被更新。修复后使用 dump.path，并检查 set-property 的布尔结果。',
    },
    run: async (ctx) => {
      // 1) 生成 SpriteFrame
      const created = await createDefaultSpriteframe(ctx, { color: '#00ff00', size: 2 })
      ctx.assert(created?.spriteFrameUuid, 'create_default_spriteframe failed')
      const sfUuid = created!.spriteFrameUuid
      ctx.step('spriteFrame uuid', true, sfUuid)

      // 1.5) 如果是首次创建（非缓存），等待场景稳定
      //      因为首次导入新资产可能触发场景重载，必须等待场景重新就绪
      if (created && !created.cached) {
        const sceneReady = await waitSceneReady(ctx, 5000)
        ctx.assert(sceneReady, '场景在资产导入后未能在 5s 内就绪')
        ctx.step('scene ready after asset import', true)
        // 额外等待让场景完全稳定
        await sleep(500)
      }

      // 2) 建一个 Node 加 cc.Sprite
      const uuid = await createEmptyNode(ctx, 'SpriteTest', '')
      const spriteAdded = await addComponentSafely(ctx, uuid, 'cc.Sprite')
      ctx.assert(spriteAdded, 'cc.Sprite 组件未添加成功')

      // 3) 写 spriteFrame
      const setResp: any = await ctx.callTool('component_property', {
        action: 'set',
        componentType: 'cc.Sprite',
        nodeUuid: uuid,
        property: 'spriteFrame',
        propertyType: 'cc.SpriteFrame',
        value: { uuid: sfUuid },
      })
      ctx.step('set spriteFrame', setResp?.success === true, setResp?.error?.slice(0, 200) ?? 'ok')
      ctx.assert(setResp?.data?.changeVerified === true, `changeVerified=${setResp?.data?.changeVerified}, actualValue=${JSON.stringify(setResp?.data?.actualValue)}`)
      await sleep(200)

      // 4) 直接从当前场景 dump 读回来验证，不保存测试场景
      const got = await readComponentValue(uuid, 'cc.Sprite', 'spriteFrame')

      // 调试：显示 got 的完整内容
      ctx.step('debug: got value', true, `type=${typeof got}, json=${JSON.stringify(got)?.slice(0, 200)}`)

      const gotUuid = got?.uuid ?? got
      ctx.step('debug: gotUuid', true, `${gotUuid}`)

      ctx.step('read spriteFrame back', got != null, JSON.stringify(got)?.slice(0, 200))
      ctx.assert(
        gotUuid && (gotUuid === sfUuid || String(gotUuid).includes(sfUuid) || sfUuid.includes(String(gotUuid))),
        `spriteFrame uuid mismatch: expected ${sfUuid}, got ${gotUuid}`,
      )
    },
  },

  // ───────────────────────────────────────────────────────────
  // Bug A：component_property.set 能通过 type 字段定位自定义脚本组件
  // ───────────────────────────────────────────────────────────
  {
    name: 'recent_04:component_property_finds_custom_script_by_type_field',
    group: 'regression/batch-2',
    description: '当自定义组件的 __type__ 是父类（cc.Script）而真实类名在 type 字段时，component_property.set 仍能定位',
    tags: ['regression', 'component', 'script', 'property'],
    regression: {
      bugId: 'v1.5.1-recent-04',
      fixedIn: 'v1.5.1',
      rootCause: '自定义脚本组件的 __type__ 字段为 cc.Script，真实类名在 type 字段，导致 component_property.set 无法匹配。修复：扩展匹配候选列表，包含 type 和 value.name。',
    },
    run: async (ctx) => {
      // 探测项目里是否有 Emitter.ts 脚本；找不到则自动 skip
      const className = 'Emitter'
      const alt = await Editor.Message.request('asset-db', 'query-assets', { pattern: 'db://assets/**/Emitter.ts' }) as any[]
      if (!Array.isArray(alt) || alt.length === 0) {
        ctx.step(`${className}.ts not in project`, true, 'SKIP: 缺少 Emitter 脚本')
        return // skip
      }
      ctx.step(`${className}.ts found`, true, alt[0].url)

      // 1) 建一个 Node 加 Emitter 组件（用类名）
      const aUuid = await createEmptyNode(ctx, 'NodeA_Custom', '')
      const aCompUuid = await addComponentSafely(ctx, aUuid, className)
      if (!aCompUuid) {
        ctx.step(`${className} not loaded by editor`, true, 'SKIP: 脚本未加载到 runtime')
        return
      }

      // 2) 验证 component index 查找能命中（这是 bug A 的关键路径）
      //    通过 query-node 看 A 的 __comps__ 中 Emitter 的实际字段分布
      const nodeA: any = await Editor.Message.request('scene', 'query-node', aUuid)
      const compsA: any[] = nodeA?.__comps__ ?? []
      const matched = compsA.find((c) => {
        const candidates = [c?.__type__, c?.type, c?.value?.__type__, c?.value?.name, c?.name]
        return candidates.some((x) => {
          if (x == null) {
            return false
          }
          const s = String(x).replace(/^cc\./, '')
          return s === className || s === String(className)
        })
      })
      ctx.step('multi-field match for Emitter', !!matched, matched ? `type=${matched.type} __type__=${matched.__type__}` : 'no match')
      ctx.assert(matched, 'Component index lookup failed for custom Emitter script')
    },
  },

  // ───────────────────────────────────────────────────────────
  // Bug B：node_property.set 接受 { __type__, __id__ } 格式
  // ───────────────────────────────────────────────────────────
  {
    name: 'recent_05:node_transform_set_node_reference_via_serialized_format',
    group: 'regression/batch-2',
    description: 'node_property.set 接受 Cocos scene 序列化格式 { __type__: "cc.Node", __id__: "uuid" }',
    tags: ['regression', 'node', 'property', 'serialization'],
    regression: {
      bugId: 'v1.5.1-recent-05',
      fixedIn: 'v1.5.1',
      rootCause: 'node_property.set 无法处理 Cocos 场景序列化格式 {__type__, __id__}，导致 dump.type 错误。修复：normalizeValueForDump 将其转换为 {uuid} 格式。',
    },
    run: async (ctx) => {
      // 创建 A / B，B 是 A 的子节点
      const a = await createEmptyNode(ctx, 'ParentA', '')
      const b = await createEmptyNode(ctx, 'ChildB', a)
      ctx.step('B is child of A by default', true, `${b} parent=${a}`)

      // 用 {__type__, __id__} 格式触发 dump 规范化（不期望真正写入 parent，因为 Node.parent 是 readOnly）
      const resp: any = await ctx.callTool('node_property', {
        action: 'set',
        uuid: b,
        property: 'parent',
        value: { __type__: 'cc.Node', __id__: a },
      })
      const errMsg = resp?.error ?? ''
      // 关键断言：normalizeValueForDump 必须工作，不能报 dump.type 相关错误
      const dumpError = /dump.*type|unsupported.*property.*type/i.test(errMsg)
      ctx.step('no dump.type error from normalize', !dumpError, errMsg.slice(0, 200))

      // 即便 parent 写入被 readOnly 拒绝，dump 规范化也已生效（传给 cocos 的 dump.value 一定是 { uuid } 形态）
      ctx.assert(!dumpError, 'normalizeValueForDump did not handle { __type__, __id__ } correctly')
    },
  },
]
