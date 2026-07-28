/**
 * 回归测试 - 第六批（MCP 调用可靠性）
 *
 * 覆盖查询优先、组件实例 UUID 以及脚本资产未就绪时的恢复提示。
 */

import type { TestCase } from '../../test-infra/metadata'

export const batch6Tests: TestCase[] = [
  {
    name: 'mcp_reliability_01:remove_component_identity_guidance',
    group: 'regression/batch-6',
    description: '组件删除失败时返回可用组件身份，并引导使用实例 UUID 查询后再删除',
    environment: 'scene',
    tags: ['regression', 'mcp', 'component', 'recovery'],
    regression: {
      bugId: 'mcp-reliability-component-identity',
      fixedIn: 'next',
      rootCause: '调用方使用过期或错误的组件 type/cid，失败提示没有直接提供当前组件实例身份和下一步查询动作。',
    },
    run: async (ctx) => {
      const created: any = await ctx.callTool('node_lifecycle', {
        action: 'create',
        name: 'McpRemovalIdentityRegression',
        nodeType: '2DNode',
      })
      const nodeUuid = created?.data?.uuid ?? created?.uuid
      ctx.assert(typeof nodeUuid === 'string', created?.error ?? 'node_lifecycle.create returned no uuid')
      ctx.trackNode(nodeUuid)

      try {
        const added: any = await ctx.callTool('component_manage', {
          action: 'add',
          nodeUuid,
          componentType: 'cc.Label',
        })
        ctx.assert(added?.success === true, added?.error ?? 'cc.Label was not added')

        const queried: any = await ctx.callTool('component_query', {
          action: 'get_components',
          nodeUuid,
        })
        const components = queried?.data?.components ?? queried?.components ?? []
        const label = components.find((component: any) => component.type === 'cc.Label' || component.cid === 'cc.Label')
        ctx.assert(label, `cc.Label was not found: ${JSON.stringify(components)}`)
        ctx.assert(typeof label.uuid === 'string' && label.uuid.length > 0, `component uuid missing: ${JSON.stringify(label)}`)

        const wrongRemoval: any = await ctx.callTool('component_manage', {
          action: 'remove',
          nodeUuid,
          componentType: 'stale-component-identity',
        })
        ctx.assert(wrongRemoval?.success === false, 'stale component identity should fail')
        ctx.assert(wrongRemoval?.metadata?.nextTool === 'component_query', JSON.stringify(wrongRemoval))
        ctx.assert(
          (wrongRemoval?.data?.availableComponents ?? []).some((component: any) => component.uuid === label.uuid),
          `available component uuid missing: ${JSON.stringify(wrongRemoval)}`,
        )

        const removed: any = await ctx.callTool('component_manage', {
          action: 'remove',
          nodeUuid,
          componentType: label.uuid,
        })
        ctx.assert(removed?.success === true, removed?.error ?? 'component removal by instance uuid failed')
      }
      finally {
        await ctx.callTool('node_lifecycle', { action: 'delete', uuid: nodeUuid }).catch(() => undefined)
      }
    },
  },
  {
    name: 'mcp_reliability_02:attach_missing_asset_recovery',
    group: 'regression/batch-6',
    description: '脚本资产未注册时 attach 不应写入组件，并返回刷新资产的恢复步骤',
    environment: 'scene',
    tags: ['regression', 'mcp', 'script', 'asset', 'recovery'],
    regression: {
      bugId: 'mcp-reliability-script-asset-readiness',
      fixedIn: 'next',
      rootCause: '脚本资产尚未被 Cocos Asset DB 注册时直接 create-component，导致写入后验证失败并诱发重复 attach。',
    },
    run: async (ctx) => {
      const created: any = await ctx.callTool('node_lifecycle', {
        action: 'create',
        name: 'McpMissingScriptAssetRegression',
        nodeType: '2DNode',
      })
      const nodeUuid = created?.data?.uuid ?? created?.uuid
      ctx.assert(typeof nodeUuid === 'string', created?.error ?? 'node_lifecycle.create returned no uuid')
      ctx.trackNode(nodeUuid)

      try {
        const response: any = await ctx.callTool('component_script', {
          action: 'attach',
          nodeUuid,
          scriptPath: 'db://assets/__mcp_missing__/NeverImported.ts',
        })
        ctx.assert(response?.success === false, 'missing script asset should not attach')
        ctx.assert(response?.metadata?.category === 'asset', JSON.stringify(response))
        ctx.assert(response?.metadata?.nextTool === 'project_manage', JSON.stringify(response))
        ctx.assert(response?.metadata?.nextAction === 'refresh_assets', JSON.stringify(response))

        const components: any = await ctx.callTool('component_query', {
          action: 'get_components',
          nodeUuid,
        })
        const list = components?.data?.components ?? components?.components ?? []
        ctx.assert(!list.some((component: any) => component.type === 'NeverImported'), `unexpected attached script: ${JSON.stringify(list)}`)
      }
      finally {
        await ctx.callTool('node_lifecycle', { action: 'delete', uuid: nodeUuid }).catch(() => undefined)
      }
    },
  },
]
