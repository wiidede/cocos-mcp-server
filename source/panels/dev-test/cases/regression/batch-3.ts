/**
 * 回归测试 - 第三批
 *
 * 覆盖两个组件引用（@property(SomeComponent)）写入相关的 quirk：
 *   - Quirk 1: 写入组件引用后 changeVerified 误报 false（假阴性），但场景实际已写入
 *   - Quirk 2: 覆盖已有的组件引用值时静默失败（写成 null），需先清空再写
 *
 * 用 cc.Slider.handle（声明类型 cc.Sprite）作为自包含 fixture，
 * 不依赖用户项目里的自定义脚本。
 */

import type { TestCase, TestContext } from '../../test-infra/metadata'
import { sleep } from '../../test-infra/setup'

// ─────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────

/** 在测试场景里建一个空 Node（node_lifecycle + action: 'create'），返回 uuid */
async function createEmptyNode(ctx: TestContext, name: string, parentUuid = ''): Promise<string> {
  const args: any = { action: 'create', name, nodeType: '2DNode' }
  if (parentUuid) {
    args.parentUuid = parentUuid
  }
  const resp: any = await ctx.callTool('node_lifecycle', args)
  const uuid = resp?.uuid ?? resp?.data?.uuid
  ctx.assert(uuid, `node_lifecycle.create(${name}) returned no uuid. resp=${JSON.stringify(resp)?.slice(0, 200)}`)
  ctx.step(`create node "${name}"`, true, uuid)
  return uuid
}

/** 给节点加组件，返回是否成功 */
async function addComponentSafely(ctx: TestContext, nodeUuid: string, componentType: string): Promise<boolean> {
  try {
    const resp: any = await ctx.callTool('component_manage', { action: 'add', nodeUuid, componentType })
    if (resp?.success === false) {
      ctx.step(`add ${componentType}`, false, resp?.error?.slice(0, 120) ?? 'failed')
      return false
    }
    ctx.step(`add ${componentType}`, true, resp?.data?.componentVerified === true ? 'verified' : 'reported ok')
    return true
  }
  catch (e: any) {
    ctx.step(`add ${componentType}`, false, e?.message?.slice(0, 120) ?? String(e))
    return false
  }
}

const normType = (s: any) => String(s ?? '').replace(/^cc\./, '')

/** 在节点的 __comps__ 里按类型找组件（去 cc. 前缀比较） */
function findComp(node: any, componentType: string): any {
  const comps: any[] = node?.__comps__ ?? []
  const target = normType(componentType)
  return comps.find(c =>
    [c?.type, c?.cid, c?.__type__, c?.value?.__type__, c?.value?.name]
      .some(x => x != null && normType(x) === target),
  )
}

/** 取组件在场景中的 id（写引用/比对引用用的就是这个） */
function getCompSceneId(comp: any): string | null {
  return comp?.value?.uuid?.value ?? comp?.uuid?.value ?? comp?.uuid ?? null
}

/** 读某节点上某组件的引用属性，返回写入的目标 scene id（读不到返回 null） */
async function readComponentRefUuid(
  nodeUuid: string,
  componentType: string,
  property: string,
): Promise<{ found: boolean, uuid: string | null, raw: any }> {
  const node: any = await Editor.Message.request('scene', 'query-node', nodeUuid).catch(() => null)
  const comp = findComp(node, componentType)
  if (!comp) {
    return { found: false, uuid: null, raw: null }
  }
  // 引用属性名可能带/不带下划线前缀
  const variants = [property, property.startsWith('_') ? property.slice(1) : `_${property}`]
  for (const p of variants) {
    const d = comp?.value?.[p]
    if (d != null && typeof d === 'object') {
      const val = 'value' in d ? d.value : d
      const uuid = val?.uuid?.value ?? val?.uuid ?? (typeof val === 'string' ? val : null)
      return { found: true, uuid, raw: d }
    }
  }
  return { found: true, uuid: null, raw: null }
}

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

export const batch3Tests: TestCase[] = [
  // ───────────────────────────────────────────────────────────
  // Quirk 1: 组件引用写入后 changeVerified 假阴性
  // ───────────────────────────────────────────────────────────
  {
    name: 'batch3_01:component_ref_set_and_verify',
    group: 'regression/batch-3',
    description: '写入组件引用（cc.Slider.handle → cc.Sprite）应真正写入场景，且 changeVerified 不应误报 false',
    tags: ['regression', 'component', 'property'],
    regression: {
      bugId: 'v1.5.2-quirk-01',
      fixedIn: 'v1.5.2',
      rootCause: '组件引用写入后 verifyPropertyChange 读回比较 uuid 失败，导致 changeVerified 误报 false（假阴性），但场景文件实际已正确写入。',
    },
    run: async (ctx) => {
      // 1) Slider 节点 + cc.Slider
      const sliderUuid = await createEmptyNode(ctx, 'SliderNode', '')
      ctx.assert(await addComponentSafely(ctx, sliderUuid, 'cc.Slider'), 'cc.Slider 组件未添加成功')

      // 2) Handle 节点 + cc.Sprite（作为引用目标）
      const handleUuid = await createEmptyNode(ctx, 'HandleNode', '')
      ctx.assert(await addComponentSafely(ctx, handleUuid, 'cc.Sprite'), 'cc.Sprite 组件未添加成功')
      await sleep(150)

      const handleNode: any = await Editor.Message.request('scene', 'query-node', handleUuid)
      const spriteId = getCompSceneId(findComp(handleNode, 'cc.Sprite'))
      ctx.step('handle sprite scene id', spriteId != null, String(spriteId))
      ctx.assert(spriteId != null, '拿不到 HandleNode 上 cc.Sprite 的 scene id')

      // 3) 写引用：value 传 handle 节点 uuid，工具会在该节点上按声明类型取 Sprite
      const setResp: any = await ctx.callTool('component_property', {
        action: 'set',
        componentType: 'cc.Slider',
        nodeUuid: sliderUuid,
        property: 'handle',
        value: handleUuid,
      })
      const changeVerified = setResp?.data?.changeVerified
      ctx.step('set handle', setResp?.success === true, setResp?.error?.slice(0, 200) ?? `changeVerified=${changeVerified}`)
      ctx.assert(setResp?.success === true, `set handle 调用失败: ${JSON.stringify(setResp)?.slice(0, 200)}`)
      await sleep(200)

      // 4) 读回场景实际值：应指向 handle 的 Sprite（这是"真正写入了吗"的权威判断）
      const back = await readComponentRefUuid(sliderUuid, 'cc.Slider', 'handle')
      ctx.step('read handle back', back.found, JSON.stringify(back.raw)?.slice(0, 200) ?? 'null')
      ctx.assert(back.uuid != null, 'handle 读回为 null —— 组件引用实际未写入')
      ctx.assert(
        String(back.uuid) === String(spriteId),
        `handle 指向错误: expected ${spriteId}, got ${back.uuid}`,
      )

      // 5) 验证 changeVerified 与实际是否一致（quirk 1：假阴性）
      ctx.step('changeVerified matches actual write', changeVerified === true, `changeVerified=${changeVerified}，实际已写入=true`)
      ctx.assert(
        changeVerified === true,
        `changeVerified 误报为 ${changeVerified}，但场景实际已写入 —— 组件引用验证逻辑假阴性`,
      )
    },
  },

  // ───────────────────────────────────────────────────────────
  // Quirk 2: 覆盖已有组件引用值静默失败（写成 null）
  // ───────────────────────────────────────────────────────────
  {
    name: 'batch3_02:component_ref_overwrite',
    group: 'regression/batch-3',
    description: '覆盖已存在的组件引用（cc.Slider.handle 从 SpriteA 改到 SpriteB）应生效，不应静默写成 null',
    tags: ['regression', 'component', 'property'],
    regression: {
      bugId: 'v1.5.2-quirk-02',
      fixedIn: 'v1.5.2',
      rootCause: '组件引用字段已有值时，直接用新值覆盖会静默失败（写成 null）；当前须先把字段清空为 null 再写才成功。',
    },
    run: async (ctx) => {
      // Slider + 两个 Sprite 目标
      const sliderUuid = await createEmptyNode(ctx, 'SliderNode2', '')
      ctx.assert(await addComponentSafely(ctx, sliderUuid, 'cc.Slider'), 'cc.Slider 组件未添加成功')

      const aUuid = await createEmptyNode(ctx, 'HandleA', '')
      ctx.assert(await addComponentSafely(ctx, aUuid, 'cc.Sprite'), 'HandleA cc.Sprite 未添加成功')
      const bUuid = await createEmptyNode(ctx, 'HandleB', '')
      ctx.assert(await addComponentSafely(ctx, bUuid, 'cc.Sprite'), 'HandleB cc.Sprite 未添加成功')
      await sleep(150)

      const nodeA: any = await Editor.Message.request('scene', 'query-node', aUuid)
      const nodeB: any = await Editor.Message.request('scene', 'query-node', bUuid)
      const spriteA = getCompSceneId(findComp(nodeA, 'cc.Sprite'))
      const spriteB = getCompSceneId(findComp(nodeB, 'cc.Sprite'))
      ctx.assert(spriteA != null && spriteB != null, `拿不到 Sprite scene id: A=${spriteA}, B=${spriteB}`)

      // 首次写入 A
      const set1: any = await ctx.callTool('component_property', {
        action: 'set',
        componentType: 'cc.Slider',
        nodeUuid: sliderUuid,
        property: 'handle',
        value: aUuid,
      })
      ctx.step('set handle=A', set1?.success === true, set1?.error?.slice(0, 150) ?? 'ok')
      await sleep(200)
      const back1 = await readComponentRefUuid(sliderUuid, 'cc.Slider', 'handle')
      ctx.step('read handle=A back', back1.uuid != null, String(back1.uuid))
      ctx.assert(
        back1.uuid != null && String(back1.uuid) === String(spriteA),
        `首次写入 A 失败: expected ${spriteA}, got ${back1.uuid}`,
      )

      // 覆盖为 B（quirk 2 的关键路径：字段已有值时覆盖）
      const set2: any = await ctx.callTool('component_property', {
        action: 'set',
        componentType: 'cc.Slider',
        nodeUuid: sliderUuid,
        property: 'handle',
        value: bUuid,
      })
      ctx.step('overwrite handle=B', set2?.success === true, set2?.error?.slice(0, 150) ?? 'ok')
      await sleep(200)
      const back2 = await readComponentRefUuid(sliderUuid, 'cc.Slider', 'handle')
      ctx.step('read handle after overwrite', back2.found, JSON.stringify(back2.raw)?.slice(0, 200) ?? 'null')
      ctx.assert(back2.uuid != null, '覆盖后 handle 变成 null —— 覆盖已有组件引用时静默失败')
      ctx.assert(
        String(back2.uuid) === String(spriteB),
        `覆盖失败: expected ${spriteB}, got ${back2.uuid}（若等于 A 的 id 说明覆盖未生效）`,
      )
    },
  },
]
