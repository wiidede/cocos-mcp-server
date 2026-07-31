/**
 * 回归测试 - 第五批（3D 场景编辑）
 */

import type { TestCase } from '../../test-infra/metadata'
import { sleep } from '../../test-infra/setup'

function propertyValue(value: any): any {
  return value && typeof value === 'object' && 'value' in value ? value.value : value
}

function isComponentType(component: any, componentType: string): boolean {
  const target = componentType.replace(/^cc\./, '')
  return [component?.type, component?.cid, component?.__type__, component?.value?.type, component?.value?.cid, component?.value?.__type__]
    .some(candidate => typeof candidate === 'string' && candidate.replace(/^cc\./, '') === target)
}

export const batch5Tests: TestCase[] = [
  {
    name: 'bug_3d_01:create_3d_node_applies_top_level_transform',
    group: 'regression/batch-5',
    description: 'node_lifecycle.create 的顶层 position/rotation/scale 参数应在创建 3DNode 后立即应用',
    tags: ['regression', '3d', 'node', 'transform', 'critical'],
    regression: {
      bugId: 'v1.5.4-create-3d-transform',
      fixedIn: 'v1.5.4',
      rootCause: '公开调用使用顶层 transform 字段，而实现只读取 initialTransform，导致初始 transform 被静默忽略。',
    },
    run: async (ctx) => {
      const created: any = await ctx.callTool('node_lifecycle', {
        action: 'create',
        name: 'Initial3DTransformRegression',
        nodeType: '3DNode',
        position: { x: 4.3, y: 0, z: -5 },
        rotation: { x: 0, y: -16, z: 0 },
        scale: { x: 1, y: 2, z: 3 },
      })
      const uuid = created?.data?.uuid ?? created?.uuid
      ctx.assert(typeof uuid === 'string', created?.error ?? 'create returned no uuid')
      const node: any = await Editor.Message.request('scene', 'query-node', uuid)
      const position = propertyValue(node?.position)
      const rotation = propertyValue(node?.rotation)
      const scale = propertyValue(node?.scale)
      await ctx.callTool('node_lifecycle', { action: 'delete', uuid }).catch(() => undefined)
      ctx.assert(Number(position?.x) === 4.3 && Number(position?.z) === -5, `position = ${JSON.stringify(position)}`)
      ctx.assert(Number(rotation?.y) === -16, `rotation = ${JSON.stringify(rotation)}`)
      ctx.assert(Number(scale?.x) === 1 && Number(scale?.y) === 2 && Number(scale?.z) === 3, `scale = ${JSON.stringify(scale)}`)
    },
  },
  {
    name: 'bug_3d_01:empty_3d_node_transform_keeps_z_and_y_rotation',
    group: 'regression/batch-5',
    description: '空 3DNode 的 transform 不应被错误地按 2D 节点压平',
    tags: ['regression', '3d', 'node', 'transform', 'critical'],
    regression: {
      bugId: 'v1.5.4-empty-3d-transform',
      fixedIn: 'v1.5.4',
      rootCause: '无组件节点根据 z=0 被误判为 2D，导致 set_transform 丢弃 position.z 和 rotation.y。',
    },
    run: async (ctx) => {
      const created: any = await ctx.callTool('node_lifecycle', {
        action: 'create',
        name: 'Empty3DTransformRegression',
        nodeType: '3DNode',
      })
      const uuid = created?.data?.uuid ?? created?.uuid
      ctx.assert(typeof uuid === 'string', created?.error ?? 'create returned no uuid')
      const write: any = await ctx.callTool('node_transform', {
        action: 'set',
        uuid,
        position: { x: 4.3, y: 0, z: -5 },
        rotation: { x: 0, y: -16, z: 0 },
      })
      await sleep(150)
      const node: any = await Editor.Message.request('scene', 'query-node', uuid)
      const position = propertyValue(node?.position)
      const rotation = propertyValue(node?.rotation)
      await ctx.callTool('node_lifecycle', { action: 'delete', uuid }).catch(() => undefined)
      ctx.step('transform write succeeds', write?.success === true, write?.error)
      ctx.assert(write?.success === true, write?.error ?? 'set_transform failed')
      ctx.assert(Number(position?.z) === -5, `position.z = ${position?.z}, expected -5`)
      ctx.assert(Number(rotation?.y) === -16, `rotation.y = ${rotation?.y}, expected -16`)
    },
  },
  {
    name: 'bug_3d_03:mesh_renderer_shared_materials_accepts_uuid_array',
    group: 'regression/batch-5',
    description: 'cc.MeshRenderer.sharedMaterials 应接受 material UUID 数组并写入 Inspector 数组槽',
    tags: ['regression', '3d', 'renderer', 'material', 'asset', 'critical'],
    regression: {
      bugId: 'v1.5.4-mesh-renderer-material-array',
      fixedIn: 'v1.5.4',
      rootCause: 'cc.Material[] 需要每项是带 value/type 的 Inspector dump；普通 {uuid} 数组触发 Editor 内部 hasOwnProperty 错误。',
    },
    run: async (ctx) => {
      const assets: any[] = await Editor.Message.request('asset-db', 'query-assets', { pattern: 'db://assets/**/*.mtl' })
      if (!Array.isArray(assets) || assets.length === 0) {
        ctx.step('material asset unavailable', true, 'SKIP: project has no .mtl material asset')
        return
      }
      const materialUuid = assets[0]?.uuid
      ctx.assert(typeof materialUuid === 'string', `material has no uuid: ${JSON.stringify(assets[0])}`)
      const created: any = await ctx.callTool('node_lifecycle', {
        action: 'create',
        name: 'MeshMaterialRegression',
        nodeType: '3DNode',
        components: ['cc.MeshRenderer'],
      })
      const uuid = created?.data?.uuid ?? created?.uuid
      ctx.assert(typeof uuid === 'string', created?.error ?? 'create returned no uuid')
      const write: any = await ctx.callTool('component_property', {
        action: 'set',
        nodeUuid: uuid,
        componentType: 'cc.MeshRenderer',
        property: 'materials',
        propertyType: 'assetArray',
        value: [materialUuid],
      })
      await ctx.callTool('node_lifecycle', { action: 'delete', uuid }).catch(() => undefined)
      ctx.step('write material array', write?.success === true, write?.error)
      ctx.assert(write?.data?.changeVerified === true, `changeVerified=${write?.data?.changeVerified}, actualValue=${JSON.stringify(write?.data?.actualValue)}`)
    },
  },
  {
    name: 'bug_3d_02:box_collider_size_uses_vec3',
    group: 'regression/batch-5',
    description: 'cc.BoxCollider.size 应按 cc.Vec3 写入 x/y/z，而非 cc.Size 的 width/height',
    tags: ['regression', '3d', 'component', 'physics', 'property', 'critical'],
    regression: {
      bugId: 'v1.5.4-box-collider-size',
      fixedIn: 'v1.5.4',
      rootCause: '属性名 size 被错误当作 cc.Size，写入 BoxCollider 的 cc.Vec3 时静默成为零体积。',
    },
    run: async (ctx) => {
      const created: any = await ctx.callTool('node_lifecycle', {
        action: 'create',
        name: 'BoxColliderSizeRegression',
        nodeType: '3DNode',
      })
      const uuid = created?.data?.uuid ?? created?.uuid
      ctx.assert(typeof uuid === 'string', created?.error ?? 'create returned no uuid')
      const added: any = await ctx.callTool('component_lifecycle', { action: 'add', nodeUuid: uuid, componentType: 'cc.BoxCollider' })
      ctx.assert(added?.success === true, added?.error ?? 'could not add BoxCollider')
      await sleep(150)
      const write: any = await ctx.callTool('component_property', {
        action: 'set',
        nodeUuid: uuid,
        componentType: 'cc.BoxCollider',
        property: 'size',
        propertyType: 'vec3',
        value: { x: 2, y: 3, z: 4 },
      })
      await sleep(150)
      const node: any = await Editor.Message.request('scene', 'query-node', uuid)
      const collider = (node?.__comps__ ?? []).find((component: any) => isComponentType(component, 'cc.BoxCollider'))
      const directSize = propertyValue(collider?.value?.size ?? collider?.size)
      const inspected: any = await ctx.callTool('component_query', {
        action: 'get',
        nodeUuid: uuid,
        componentType: 'cc.BoxCollider',
      })
      const inspectedSize = propertyValue(inspected?.data?.properties?.size)
      await ctx.callTool('node_lifecycle', { action: 'delete', uuid }).catch(() => undefined)
      ctx.step('size write succeeds', write?.success === true, write?.error)
      ctx.assert(write?.success === true, write?.error ?? 'set_property failed')
      const actualSize = directSize ?? inspectedSize
      ctx.assert(Number(actualSize?.x) === 2 && Number(actualSize?.y) === 3 && Number(actualSize?.z) === 4, `BoxCollider.size = ${JSON.stringify(actualSize)}; query-node component=${JSON.stringify(collider)?.slice(0, 500)}; component_query=${JSON.stringify(inspected?.data?.properties?.size)}`)
    },
  },
]
