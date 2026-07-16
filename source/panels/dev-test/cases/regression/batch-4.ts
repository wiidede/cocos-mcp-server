/**
 * 回归测试 - 第四批
 *
 * 覆盖 debug_scene 使用未注册场景 IPC 路由的问题。
 */

import type { TestCase } from '../../test-infra/metadata'

export const batch4Tests: TestCase[] = [
  {
    name: 'batch4_01:debug_scene_node_tree_uses_supported_route',
    group: 'regression/batch-4',
    description: 'debug_scene.node_tree 应返回场景树，不调用不存在的 query-hierarchy 路由',
    tags: ['regression', 'debug', 'scene', 'critical'],
    regression: {
      bugId: 'v1.5.3-debug-scene-node-tree',
      fixedIn: 'v1.5.3',
      rootCause: 'debug_scene.node_tree 调用未注册的 scene/query-hierarchy IPC，而非已验证的 query-node-tree。',
    },
    run: async (ctx) => {
      const response: any = await ctx.callTool('debug_scene', { action: 'node_tree' })
      ctx.step('node tree succeeds', response?.success === true, response?.error?.slice(0, 200))
      ctx.assert(response?.success === true, `node_tree failed: ${response?.error ?? JSON.stringify(response)?.slice(0, 200)}`)

      const tree = response.data
      ctx.step('scene root returned', tree?.uuid != null, tree?.name)
      ctx.assert(tree?.uuid != null, 'node_tree did not return the scene root')
    },
  },
  {
    name: 'batch4_02:debug_scene_validate_performance_uses_supported_route',
    group: 'regression/batch-4',
    description: 'debug_scene.validate 性能检查应完成，不调用不存在的 query-hierarchy 路由',
    tags: ['regression', 'debug', 'scene', 'critical'],
    regression: {
      bugId: 'v1.5.3-debug-scene-validate',
      fixedIn: 'v1.5.3',
      rootCause: 'debug_scene.validate 的性能分支调用未注册的 scene/query-hierarchy IPC，缺失资源分支调用未注册的 check-missing-assets。',
    },
    run: async (ctx) => {
      const response: any = await ctx.callTool('debug_scene', {
        action: 'validate',
        checkPerformance: true,
      })
      ctx.step('validation succeeds', response?.success === true, response?.error?.slice(0, 200))
      ctx.assert(response?.success === true, `validate failed: ${response?.error ?? JSON.stringify(response)?.slice(0, 200)}`)
      ctx.assert(typeof response?.data?.valid === 'boolean', 'validate did not return a valid flag')
    },
  },
  {
    name: 'batch4_03:scene_undo_multi_target_lifecycle',
    group: 'regression/batch-4',
    description: 'scene_undo_manage 应支持多目标和 label，并返回可用于 end/cancel 的 undoId',
    tags: ['regression', 'scene', 'undo', 'critical'],
    regression: {
      bugId: 'v1.5.3-scene-undo-contract',
      fixedIn: 'v1.5.3',
      rootCause: '公开 schema 只暴露可选 nodeUuid，未表达 Cocos begin-recording 的目标 UUID 集合、tag、显式生命周期及 undoId 契约。',
    },
    run: async (ctx) => {
      const schemaResponse: any = await ctx.callTool('tool_registry', { action: 'describe', toolName: 'scene_undo_manage' })
      const schemaProperties = schemaResponse?.data?.inputSchema?.properties
      const schemaComplete = schemaProperties?.nodeUuid && schemaProperties?.nodeUuids && schemaProperties?.label && schemaProperties?.undoId
      ctx.step('undo schema exposes lifecycle parameters', Boolean(schemaComplete), JSON.stringify(Object.keys(schemaProperties ?? {})))
      ctx.assert(Boolean(schemaComplete), 'scene_undo_manage schema is missing nodeUuid, nodeUuids, label, or undoId')

      const createNode = async (name: string): Promise<string> => {
        const response: any = await ctx.callTool('node_lifecycle', { action: 'create', name, nodeType: '2DNode' })
        const uuid = response?.data?.uuid ?? response?.uuid
        ctx.assert(typeof uuid === 'string' && uuid.length > 0, `create ${name} failed: ${response?.error ?? 'missing uuid'}`)
        return uuid
      }
      const nodeA = await createNode('UndoTargetA')
      const nodeB = await createNode('UndoTargetB')

      const begin: any = await ctx.callTool('scene_undo_manage', {
        action: 'begin',
        nodeUuids: [nodeA, nodeB],
        label: 'Dev Test Multi Target Undo',
      })
      const undoId = begin?.data?.undoId
      ctx.step('begin returns undoId', typeof undoId === 'string' && undoId.length > 0, String(undoId))
      ctx.assert(begin?.success === true && typeof undoId === 'string' && undoId.length > 0, begin?.error ?? 'begin returned no undoId')

      const renameA: any = await ctx.callTool('node_transform', { action: 'set_property', uuid: nodeA, property: 'name', value: 'UndoTargetAChanged' })
      const renameB: any = await ctx.callTool('node_transform', { action: 'set_property', uuid: nodeB, property: 'name', value: 'UndoTargetBChanged' })
      ctx.assert(renameA?.success === true && renameB?.success === true, `target mutation failed: A=${renameA?.error}, B=${renameB?.error}`)

      const end: any = await ctx.callTool('scene_undo_manage', { action: 'end', undoId })
      ctx.step('end accepts undoId', end?.success === true, end?.error)
      ctx.assert(end?.success === true, end?.error ?? 'end failed')

      const secondBegin: any = await ctx.callTool('scene_undo_manage', {
        action: 'begin',
        nodeUuid: nodeA,
        label: 'Dev Test Cancel Undo',
      })
      const secondUndoId = secondBegin?.data?.undoId
      ctx.assert(typeof secondUndoId === 'string' && secondUndoId.length > 0, secondBegin?.error ?? 'second begin returned no undoId')
      const cancel: any = await ctx.callTool('scene_undo_manage', { action: 'cancel', undoId: secondUndoId })
      ctx.step('cancel accepts undoId', cancel?.success === true, cancel?.error)
      ctx.assert(cancel?.success === true, cancel?.error ?? 'cancel failed')
    },
  },
  {
    name: 'batch4_04:prefab_create_and_validate_complete_asset',
    group: 'regression/batch-4',
    description: 'prefab_lifecycle.create 应首次写入完整 Prefab，prefab_browse.validate 应通过 query-path 读取并验证',
    tags: ['regression', 'prefab', 'asset-db', 'critical'],
    regression: {
      bugId: 'v1.5.3-prefab-script-cid-and-validation',
      fixedIn: 'v1.5.3',
      rootCause: 'Prefab 创建先导入不完整临时文档，自定义组件又将类名而非 cid 写入 __type__；校验调用了不存在的 asset-db/read-asset。',
    },
    run: async (ctx) => {
      const prefabPath = 'db://assets/__dev_test__/PrefabLifecycleRegression.prefab'
      const nodeResponse: any = await ctx.callTool('node_lifecycle', {
        action: 'create',
        name: 'PrefabLifecycleRegression',
        nodeType: 'Node',
      })
      const nodeUuid = nodeResponse?.data?.uuid ?? nodeResponse?.uuid
      ctx.assert(typeof nodeUuid === 'string' && nodeUuid.length > 0, nodeResponse?.error ?? 'create node returned no uuid')

      const createResponse: any = await ctx.callTool('prefab_lifecycle', {
        action: 'create',
        nodeUuid,
        savePath: prefabPath,
        prefabName: 'PrefabLifecycleRegression',
      })
      const validateResponse: any = createResponse?.success === true
        ? await ctx.callTool('prefab_browse', { action: 'validate', prefabPath })
        : null
      const instantiateResponse: any = createResponse?.success === true
        ? await ctx.callTool('prefab_instance', { action: 'instantiate', prefabPath })
        : null
      const instanceUuid = instantiateResponse?.data?.nodeUuid
      const createdInstanceUuid = instantiateResponse?.data?.createdNodeUuid
      const candidateNodeUuids = Array.isArray(instantiateResponse?.data?.candidateNodeUuids)
        ? instantiateResponse.data.candidateNodeUuids.filter((uuid: unknown): uuid is string => typeof uuid === 'string')
        : []
      const referenceResponse: any = createResponse?.success === true
        ? await ctx.callTool('prefab_reference', { action: 'nodes_by_asset_uuid', assetUuid: createResponse?.data?.prefabUuid })
        : null

      const linkedNodeUuids = Array.isArray(referenceResponse?.data?.nodeUuids)
        ? referenceResponse.data.nodeUuids.filter((uuid: unknown): uuid is string => typeof uuid === 'string')
        : []
      const cleanupNodeUuids = new Set([nodeUuid, instanceUuid, createdInstanceUuid, ...candidateNodeUuids, ...linkedNodeUuids].filter((uuid): uuid is string => typeof uuid === 'string'))
      for (const uuid of cleanupNodeUuids)
        await ctx.callTool('node_lifecycle', { action: 'delete', uuid }).catch(() => undefined)
      await ctx.callTool('asset_manage', { action: 'delete', url: prefabPath }).catch(() => undefined)

      ctx.step('create returns a valid imported asset', createResponse?.success === true && createResponse?.data?.invalid === false, createResponse?.error)
      ctx.assert(createResponse?.success === true, createResponse?.error ?? 'prefab create failed')
      ctx.assert(createResponse?.data?.invalid === false, 'prefab create did not confirm invalid=false')
      ctx.step('validate reads and accepts the prefab', validateResponse?.success === true && validateResponse?.data?.valid === true, validateResponse?.error)
      ctx.assert(validateResponse?.success === true && validateResponse?.data?.valid === true, validateResponse?.error ?? 'prefab validate failed')
      const instantiateDetails = JSON.stringify({ error: instantiateResponse?.error, data: instantiateResponse?.data })
      ctx.step('instantiate verifies prefab linkage', instantiateResponse?.success === true && instantiateResponse?.data?.prefabLinked === true, instantiateDetails.slice(0, 2000))
      ctx.assert(instantiateResponse?.success === true && instantiateResponse?.data?.prefabLinked === true, instantiateDetails)
      ctx.step('prefab reference query finds the instance', referenceResponse?.data?.nodeUuids?.includes(instanceUuid) === true, referenceResponse?.error)
      ctx.assert(referenceResponse?.data?.nodeUuids?.includes(instanceUuid) === true, 'prefab reference query did not find the instantiated node')
    },
  },
  {
    name: 'batch4_05:prefab_browse_load_opens_prefab_editor',
    group: 'regression/batch-4',
    description: 'prefab_browse.load 应通过 asset-db/open-asset 打开有效 Prefab，而不是调用不存在的 scene/load-asset',
    tags: ['regression', 'prefab', 'asset-db', 'critical'],
    regression: {
      bugId: 'v1.5.3-prefab-load-route',
      fixedIn: 'v1.5.3',
      rootCause: 'Prefab 加载错误路由到未注册的 scene/load-asset，并错误依赖该消息返回 Prefab 数据。',
    },
    run: async (ctx) => {
      const prefabPath = 'db://assets/__dev_test__/PrefabLoadRegression.prefab'
      const nodeResponse = await ctx.callTool('node_lifecycle', {
        action: 'create',
        name: 'PrefabLoadRegression',
        nodeType: 'Node',
      })
      const nodeUuid = nodeResponse?.data?.uuid ?? nodeResponse?.uuid
      ctx.assert(typeof nodeUuid === 'string' && nodeUuid.length > 0, nodeResponse?.error ?? 'create node returned no uuid')

      const createResponse = await ctx.callTool('prefab_lifecycle', {
        action: 'create',
        nodeUuid,
        savePath: prefabPath,
        prefabName: 'PrefabLoadRegression',
      })
      ctx.assert(createResponse?.success === true, createResponse?.error ?? 'prefab create failed')

      const loadResponse = await ctx.callTool('prefab_browse', { action: 'load', prefabPath })
      const loaded = loadResponse?.success === true
        && loadResponse?.data?.uuid === createResponse?.data?.prefabUuid
        && loadResponse?.data?.prefabPath === prefabPath
      ctx.step('load opens prefab editor through a registered route', loaded, loadResponse?.error)
      ctx.assert(loaded, loadResponse?.error ?? JSON.stringify(loadResponse?.data))
    },
  },
]
