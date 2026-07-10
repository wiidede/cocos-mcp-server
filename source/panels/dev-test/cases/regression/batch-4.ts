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
]
