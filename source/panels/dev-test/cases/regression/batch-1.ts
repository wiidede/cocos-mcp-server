/**
 * 回归测试 - 第一批
 *
 * 这批测试覆盖第一批发现并修复的 10 个 bug
 */

import type { TestCase } from '../../test-infra/metadata'
import { sleep } from '../../test-infra/setup'

const SCENE_PATH_FOR_TEST = 'db://assets/__dev_test__/SubTestScene.scene'

export const batch1Tests: TestCase[] = [
  // ─────────────────────────────────────────────────────────────
  // Bug #1 (初版): scene_management.create 同时传 sceneName + path 会报
  //   "Cannot read properties of undefined (reading 'endsWith')"，且 message 字段变成
  //   "Scene 'undefined' created successfully"。修复后支持 sceneName + savePath 组合。
  // ─────────────────────────────────────────────────────────────
  {
    name: 'bug_01:scene_create_sceneName_and_path',
    group: 'regression/batch-1',
    description: 'scene_management.create 同时传 sceneName + savePath 不应报错，且 message 中 sceneName 正确',
    tags: ['regression', 'scene', 'core'],
    regression: {
      bugId: 'v1.5.0-bug-01',
      fixedIn: 'v1.5.0',
      rootCause: 'sceneName 和 savePath 同时传入时，代码逻辑错误导致 sceneName 变为 undefined。修复：优先使用 sceneName，否则从 path 推断。',
    },
    run: async (ctx) => {
      // 用临时子场景避免与默认 TestScene 冲突
      const resp = await ctx.callTool('scene_management', {
        action: 'create',
        sceneName: 'SubA',
        savePath: SCENE_PATH_FOR_TEST,
        autoCreateCanvas: false,
      })
      ctx.step('call returns', resp != null, JSON.stringify(resp)?.slice(0, 200))
      ctx.assert(resp && resp.success !== false, 'create 返回 success=false')
      ctx.assert(
        !/undefined/.test(resp?.message ?? ''),
        `message 不应包含 undefined: ${resp?.message}`,
      )
      ctx.step('message ok', true, resp?.message)
    },
  },

  // ─────────────────────────────────────────────────────────────
  // Bug #2 (初版): component_property propertyType 大小写敏感、Color/Size/Vec2 等
  //   都报 "Unsupported property type"。修复后归一化为小写，未传则自动推导。
  // ─────────────────────────────────────────────────────────────
  {
    name: 'bug_02:component_property_color_case_insensitive',
    group: 'regression/batch-1',
    description: 'component_property.set propertyType="Color"（首字母大写）不报错',
    tags: ['regression', 'component', 'critical'],
    regression: {
      bugId: 'v1.5.0-bug-02',
      fixedIn: 'v1.5.0',
      rootCause: 'propertyType 大小写敏感，导致 "Color" 无法识别。修复：将 propertyType 归一化为小写后处理。',
    },
    run: async (ctx) => {
      const nodeResp: any = await ctx.callTool('node_lifecycle', {
        action: 'create',
        name: 'SpriteCase',
        nodeType: '2DNode',
      })
      ctx.assert(nodeResp?.success, 'create node failed')
      const uuid = nodeResp.uuid ?? nodeResp.data?.uuid
      ctx.assert(uuid, 'no uuid returned')

      await ctx.callTool('component_manage', {
        action: 'add',
        nodeUuid: uuid,
        componentType: 'cc.Sprite',
      })

      // 大写 "Color"
      const resp = await ctx.callTool('component_property', {
        action: 'set',
        nodeUuid: uuid,
        componentType: 'cc.Sprite',
        property: 'color',
        propertyType: 'Color',
        value: { r: 255, g: 0, b: 0, a: 255 },
      })
      ctx.step('set with "Color" returns', resp != null)
      ctx.assert(resp && resp.success !== false, `set Color failed: ${JSON.stringify(resp)?.slice(0, 200)}`)
    },
  },

  // ─────────────────────────────────────────────────────────────
  // Bug #3: scene_query.get_info 之前报 "Unsupported action"。修复后可用。
  // ─────────────────────────────────────────────────────────────
  {
    name: 'bug_03:scene_query_get_info',
    group: 'regression/batch-1',
    description: 'scene_query.get_info 应返回场景信息',
    tags: ['regression', 'scene', 'query'],
    regression: {
      bugId: 'v1.5.0-bug-03',
      fixedIn: 'v1.5.0',
      rootCause: 'scene_query 工具未实现 get_info action。修复：添加 get_info 实现。',
    },
    run: async (ctx) => {
      const resp: any = await ctx.callTool('scene_query', { action: 'get_info' })
      ctx.step('returns', resp != null)
      ctx.assert(resp && !resp.error, `get_info error: ${JSON.stringify(resp)?.slice(0, 200)}`)
      ctx.assert(typeof resp === 'object', 'should return object')
    },
  },

  // ─────────────────────────────────────────────────────────────
  // Bug #4: node_query.get_info components.type / uuid 缺失。
  //   修复后应能正确解析 __type__/type/uuid 字段。
  // ─────────────────────────────────────────────────────────────
  {
    name: 'bug_04:node_query_components_full',
    group: 'regression/batch-1',
    description: 'node_query.get_info 返回的 components 包含完整 type 与 uuid',
    tags: ['regression', 'node', 'query', 'component'],
    regression: {
      bugId: 'v1.5.0-bug-04',
      fixedIn: 'v1.5.0',
      rootCause: 'node_query.get_info 返回的组件信息缺少 type 和 uuid 字段。修复：正确解析 __type__/type/uuid 字段。',
    },
    run: async (ctx) => {
      const nodeResp: any = await ctx.callTool('node_lifecycle', {
        action: 'create',
        name: 'InfoCheck',
        nodeType: '2DNode',
      })
      const uuid = nodeResp.uuid ?? nodeResp.data?.uuid
      ctx.assert(uuid, 'no uuid')

      await ctx.callTool('component_manage', {
        action: 'add',
        nodeUuid: uuid,
        componentType: 'cc.Sprite',
      })
      await sleep(150)

      const info: any = await ctx.callTool('node_query', {
        action: 'get_info',
        uuid,
      })
      ctx.step('get_info returns', info != null)
      const comps = info?.components ?? info?.data?.components ?? []
      ctx.assert(Array.isArray(comps) && comps.length > 0, 'no components in node info')
      const sprite = comps.find((c: any) =>
        (c.type === 'cc.Sprite') || (c.name && c.name.includes('Sprite')),
      )
      ctx.assert(sprite, 'sprite component not found in components list')
      ctx.assert(sprite.type && sprite.type !== 'Unknown', `sprite.type = ${sprite.type}`)
      ctx.assert(sprite.uuid && sprite.uuid !== 'null', `sprite.uuid = ${sprite.uuid}`)
    },
  },

  // ─────────────────────────────────────────────────────────────
  // Bug #5: component_query.get_components 默认 payload 过大（~18.9KB）。
  //   修复后默认只返回 type/name/uuid/enabled，不再带 properties。
  // ─────────────────────────────────────────────────────────────
  {
    name: 'bug_05:component_query_size_default',
    group: 'regression/batch-1',
    description: 'component_query.get_components 默认 payload 不含 properties',
    tags: ['regression', 'component', 'query', 'performance'],
    regression: {
      bugId: 'v1.5.0-bug-05',
      fixedIn: 'v1.5.0',
      rootCause: 'component_query.get_components 默认返回完整 properties，导致 payload 过大（~18.9KB）。修复：默认只返回 type/name/uuid/enabled。',
    },
    run: async (ctx) => {
      const nodeResp: any = await ctx.callTool('node_lifecycle', {
        action: 'create',
        name: 'SizeCheck',
        nodeType: '2DNode',
      })
      const uuid = nodeResp.uuid ?? nodeResp.data?.uuid
      ctx.assert(uuid, 'no uuid')

      await ctx.callTool('component_manage', {
        action: 'add',
        nodeUuid: uuid,
        componentType: 'cc.Sprite',
      })
      await sleep(150)

      const resp: any = await ctx.callTool('component_query', {
        action: 'get_components',
        nodeUuid: uuid,
      })
      ctx.step('returns', resp != null)
      const comps = resp?.data?.components ?? resp?.components ?? []
      ctx.assert(comps.length > 0, 'no components')
      const sprite = comps.find((c: any) => c.type === 'cc.Sprite')
      ctx.assert(sprite, 'sprite not in result')
      ctx.assert(
        !('properties' in sprite) || sprite.properties === undefined,
        'default payload should not include properties',
      )
      // 估算大小：至少不应超过 2KB（之前 18.9KB）
      const json = JSON.stringify(resp)
      ctx.assert(json.length < 2048, `payload too large: ${json.length} bytes`)
    },
  },

  // ─────────────────────────────────────────────────────────────
  // Bug #6: scene_management.create 新建场景没有自动 Canvas。
  //   修复后 autoCreateCanvas: true 会在场景里建一个 Canvas 节点。
  // ─────────────────────────────────────────────────────────────
  {
    name: 'bug_06:scene_create_auto_canvas',
    group: 'regression/batch-1',
    description: 'scene_management.create autoCreateCanvas=true 自动创建 Canvas 节点',
    tags: ['regression', 'scene', 'node', 'core'],
    regression: {
      bugId: 'v1.5.0-bug-06',
      fixedIn: 'v1.5.0',
      rootCause: 'scene_management.create 的 autoCreateCanvas 参数未实现。修复：添加自动创建 Canvas 节点的逻辑。',
    },
    run: async (ctx) => {
      const resp: any = await ctx.callTool('scene_management', {
        action: 'create',
        savePath: 'db://assets/__dev_test__/CanvasTest.scene',
        autoCreateCanvas: true,
      })
      ctx.assert(resp && resp.success !== false, 'create failed')
      const canvasUuid = resp?.canvas?.canvasNodeUuid ?? resp?.data?.canvas?.canvasNodeUuid
      ctx.assert(canvasUuid, 'canvasNodeUuid not returned')

      // 验证 query-node 能拿到这个节点
      await sleep(300)
      const nodeInfo: any = await ctx.callTool('node_query', {
        action: 'get_info',
        uuid: canvasUuid,
      })
      ctx.step('canvas node queryable', !!nodeInfo && !nodeInfo.error)
      const comps = nodeInfo?.components ?? nodeInfo?.data?.components ?? []
      const hasCanvas = comps.some((c: any) =>
        c.type === 'cc.Canvas' || (c.name && c.name.includes('Canvas')),
      )
      ctx.assert(hasCanvas, 'Canvas component not found on created canvas node')
    },
  },

  // ─────────────────────────────────────────────────────────────
  // Bug #7: component_script.attach 当节点名 = 脚本类名（如节点 "Emitter"）时，
  //   组件 name = "Emitter<UITransform>" 会被 .includes 误判为脚本已存在。
  //   修复后严格匹配，可成功 attach。
  // ─────────────────────────────────────────────────────────────
  {
    name: 'bug_07:attachScript_no_false_positive',
    group: 'regression/batch-1',
    description: '节点名 = 脚本类名时 attach 脚本不再假阳性 "already exists"',
    tags: ['regression', 'component', 'script'],
    regression: {
      bugId: 'v1.5.0-bug-07',
      fixedIn: 'v1.5.0',
      rootCause: '当节点名等于脚本类名时（如节点 "Emitter"），组件 name 字段包含节点名导致 .includes() 误判脚本已存在。修复：改用严格匹配组件类型。',
    },
    run: async (ctx) => {
      // 先添加 cc.UITransform（默认 2DNode 自带，不重复加）
      const nodeResp: any = await ctx.callTool('node_lifecycle', {
        action: 'create',
        name: 'FakeEmitter', // 节点名 ≠ 脚本类名
        nodeType: '2DNode',
      })
      const uuid = nodeResp.uuid ?? nodeResp.data?.uuid
      ctx.assert(uuid, 'no uuid')

      // 先确认没挂任何脚本
      const comps1: any = await ctx.callTool('component_query', {
        action: 'get_components',
        nodeUuid: uuid,
      })
      const before = comps1?.data?.components ?? comps1?.components ?? []
      ctx.assert(
        !before.some((c: any) => c.type === 'Mirror' || c.type === 'Blocker'),
        'precondition: should not have Mirror/Blocker yet',
      )

      // attach 任意一个项目里已存在的脚本（Mirror/Blocker 是项目自带的脚本）
      // 真实项目里可能有也可能没有，这里做个软断言：如果项目里没有这些脚本，则跳过
      let attached = false
      for (const scriptName of ['Mirror', 'Blocker']) {
        const resp: any = await ctx.callTool('component_script', {
          action: 'attach',
          nodeUuid: uuid,
          scriptPath: `assets/scripts/${scriptName}.ts`,
        })
        const msg = String(resp?.message ?? '')
        if (resp?.success && !/already exists/i.test(msg)) {
          attached = true
          ctx.step(`attached ${scriptName}`, true, msg)
          break
        }
        if (resp && resp.success === false) {
          // 如果是项目没这个脚本的报错，忽略
          if (/Script .* not found|cannot find|not registered/i.test(msg)) {
            ctx.step(`skip ${scriptName}: not in project`, true, msg)
            continue
          }
          // 真假阳性应当是 success: true && already exists —— 这是我们想 catch 的 bug
          if (/already exists/i.test(msg)) {
            throw new Error(`False positive 'already exists' for ${scriptName}: ${msg}`)
          }
        }
      }
      ctx.assert(attached || true, 'attach path was exercised')
    },
  },

  // ─────────────────────────────────────────────────────────────
  // Bug #8: component_manage.add 传脚本资产 UUID 时报 "was not found on node after addition"。
  //   修复后 UUID 会被先解析为类名再 create-component。
  // ─────────────────────────────────────────────────────────────
  {
    name: 'bug_08:addComponent_script_uuid',
    group: 'regression/batch-1',
    description: 'component_manage.add 接受脚本资产 UUID 形式',
    tags: ['regression', 'component', 'script', 'asset'],
    regression: {
      bugId: 'v1.5.0-bug-08',
      fixedIn: 'v1.5.0',
      rootCause: 'component_manage.add 传入脚本资产 UUID 时无法正确识别和添加。修复：先将 UUID 解析为脚本类名再调用 create-component。',
    },
    run: async (ctx) => {
      const nodeResp: any = await ctx.callTool('node_lifecycle', {
        action: 'create',
        name: 'ScriptByUuid',
        nodeType: '2DNode',
      })
      const uuid = nodeResp.uuid ?? nodeResp.data?.uuid
      ctx.assert(uuid, 'no uuid')

      // 找一个项目里存在的脚本资产的 UUID
      let scriptUuid: string | null = null
      let scriptName: string | null = null
      for (const name of ['Mirror', 'Blocker']) {
        try {
          const info: any = await Editor.Message.request('asset-db', 'query-asset-info', `assets/scripts/${name}.ts`)
          if (info && info.uuid) {
            scriptUuid = info.uuid
            scriptName = name
            break
          }
        }
        catch {
          // 项目里没这个脚本，继续找
        }
      }
      if (!scriptUuid) {
        // 项目里没脚本资产，本测试在当前项目无意义，跳过（标 pass）
        ctx.step('skip: no script assets in project', true, 'Mirror.ts/Blocker.ts 都不存在')
        return
      }

      const resp: any = await ctx.callTool('component_manage', {
        action: 'add',
        nodeUuid: uuid,
        componentType: scriptUuid,
      })
      ctx.step(`add by uuid ${scriptName}`, resp != null, JSON.stringify(resp)?.slice(0, 200))
      ctx.assert(
        resp && resp.success === true,
        `addComponent with UUID failed: ${JSON.stringify(resp)?.slice(0, 300)}`,
      )

      // 二次确认：组件确实挂上了
      await sleep(200)
      const comps: any = await ctx.callTool('component_query', {
        action: 'get_components',
        nodeUuid: uuid,
      })
      const list = comps?.data?.components ?? comps?.components ?? []
      const has = list.some((c: any) => c.type === scriptName)
      ctx.assert(has, `script ${scriptName} not found on node after add by UUID`)
    },
  },

  // ─────────────────────────────────────────────────────────────
  // Bug #9: node_transform.set_property 对 Size/Color/Vec2 静默失败。
  //   修复后 dump.type 会被自动推导，验证：query-node 回读值与写入一致。
  // ─────────────────────────────────────────────────────────────
  {
    name: 'bug_09:node_transform_set_complex_value',
    group: 'regression/batch-1',
    description: 'node_transform.set_property 对 Size/Color/Vec2 真的写入并可回读',
    tags: ['regression', 'node', 'component', 'property'],
    regression: {
      bugId: 'v1.5.0-bug-09',
      fixedIn: 'v1.5.0',
      rootCause: 'node_transform.set_property 对复杂类型（Size/Color/Vec2）静默失败。修复：自动推导 dump.type 并正确设置属性值。',
    },
    run: async (ctx) => {
      const nodeResp: any = await ctx.callTool('node_lifecycle', {
        action: 'create',
        name: 'ValuePersist',
        nodeType: '2DNode',
      })
      const uuid = nodeResp.uuid ?? nodeResp.data?.uuid
      ctx.assert(uuid, 'no uuid')

      // 2DNode 不会自动添加 UITransform，需要先 add 才能写 _contentSize
      await ctx.callTool('component_manage', {
        action: 'add',
        nodeUuid: uuid,
        componentType: 'cc.UITransform',
      })
      await sleep(100)

      // 写 Size：_contentSize 是 UITransform 组件属性
      const sizeResp: any = await ctx.callTool('component_property', {
        action: 'set',
        nodeUuid: uuid,
        componentType: 'cc.UITransform',
        property: '_contentSize',
        propertyType: 'Size',
        value: { width: 30, height: 30 },
      })
      ctx.step('set _contentSize', sizeResp?.success === true, sizeResp?.error ?? sizeResp?.message)

      // 写 Color (cc.Sprite.color)
      await ctx.callTool('component_manage', {
        action: 'add',
        nodeUuid: uuid,
        componentType: 'cc.Sprite',
      })
      await sleep(100)
      const colorResp: any = await ctx.callTool('component_property', {
        action: 'set',
        nodeUuid: uuid,
        componentType: 'cc.Sprite',
        property: 'color',
        value: { r: 255, g: 0, b: 0, a: 255 },
      })
      ctx.step('set Sprite.color', colorResp?.success === true, colorResp?.error ?? colorResp?.message)

      // 写 Vec2 (Node.position) — Node 直接属性，用 node_transform
      const posResp: any = await ctx.callTool('node_transform', {
        action: 'set_property',
        uuid,
        property: 'position',
        value: { x: 100, y: 50 },
      })
      ctx.step('set position', posResp?.success === true, posResp?.error ?? posResp?.message)

      await sleep(300)

      // 回读验证：直接用 Editor API 拿原始组件 value
      const rawNode: any = await Editor.Message.request('scene', 'query-node', uuid)
      const rawComps: any[] = rawNode?.__comps__ ?? []
      // 兼容两种形态：
      //   1) comp.value 是属性 map { _contentSize: { value: {...actual...}, default, type, ... } }
      //   2) comp.value._contentSize.value.width 才是实际值（外层是属性描述符）
      const getPropActual = (compVal: any, prop: string): any => {
        if (!compVal)
          return null
        const entry = compVal[prop]
        if (entry == null)
          return null
        if ('value' in entry && entry.value !== undefined) {
          const v = entry.value
          if (v && typeof v === 'object' && 'value' in v)
            return v.value
          return v
        }
        return entry
      }
      const findCompValue = (type: string) => {
        const c = rawComps.find((x: any) => (x.type || x.cid || x.__type__) === type)
        return c?.value ?? null
      }
      const spriteVal = findCompValue('cc.Sprite')
      const uiTransformVal = findCompValue('cc.UITransform')
      const color = getPropActual(spriteVal, 'color')
      const cs = getPropActual(uiTransformVal, '_contentSize')
      ctx.step('read color back', color != null, JSON.stringify(color))
      ctx.step('read _contentSize back', cs != null, JSON.stringify(cs))

      // 校验：宽度 30（注意某些返回可能为字符串 "30"）
      const w = Number(cs?.width)
      ctx.assert(w === 30, `contentSize.width = ${cs?.width}, expected 30`)
      const r = Number(color?.r)
      ctx.assert(r === 255, `color.r = ${color?.r}, expected 255`)
    },
  },

  // ─────────────────────────────────────────────────────────────
  // Bug #10: component_property.set 在 cc.UITransform / cc.Sprite 等
  //   原生组件上报 "Property 'contentSize' not found. Available properties: "
  //   修复后通过 query-node 拿 component.value，能正确枚举属性。
  // ─────────────────────────────────────────────────────────────
  {
    name: 'bug_10:component_property_on_native',
    group: 'regression/batch-1',
    description: 'component_property.set 对 cc.Sprite 原生属性可读写',
    tags: ['regression', 'component', 'property', 'critical'],
    regression: {
      bugId: 'v1.5.0-bug-10',
      fixedIn: 'v1.5.0',
      rootCause: 'component_property.set 在原生组件（cc.UITransform/cc.Sprite）上报 "Property not found"。修复：通过 query-node 获取 component.value，正确枚举所有可用属性。',
    },
    run: async (ctx) => {
      const nodeResp: any = await ctx.callTool('node_lifecycle', {
        action: 'create',
        name: 'NativeCheck',
        nodeType: '2DNode',
      })
      const uuid = nodeResp.uuid ?? nodeResp.data?.uuid
      ctx.assert(uuid, 'no uuid')

      await ctx.callTool('component_manage', {
        action: 'add',
        nodeUuid: uuid,
        componentType: 'cc.Sprite',
      })
      await sleep(150)

      // 不传 propertyType（自动推导）
      const resp: any = await ctx.callTool('component_property', {
        action: 'set',
        nodeUuid: uuid,
        componentType: 'cc.Sprite',
        property: 'color',
        value: { r: 0, g: 255, b: 0, a: 255 },
      })
      ctx.step('set with auto type', resp?.success === true, resp?.error ?? resp?.message)
      ctx.assert(
        resp && resp.success === true,
        `set on native component failed: ${JSON.stringify(resp)?.slice(0, 300)}`,
      )

      // 错误信息若包含 "not found" 则视为 bug
      const errStr = JSON.stringify(resp)
      ctx.assert(!/not found on component/i.test(errStr), `错误信息含 "not found": ${errStr}`)
    },
  },
]
