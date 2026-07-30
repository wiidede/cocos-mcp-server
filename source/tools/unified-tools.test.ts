import type { JsonSchema, ToolExecutor } from '../types'
import type { LegacyExecutorOverrides, LegacyPrefix } from './unified-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UnifiedTools } from './unified-tools'

interface RegistryAction {
  name: string
  description: string
  properties: string[]
  required: string[]
  requiredAnyOf?: string[][]
  example?: Record<string, unknown>
  status: 'supported' | 'deprecated' | 'unsupported'
  unsupportedReason?: string
}

function getActionSchema(toolSchema: JsonSchema, action: string): JsonSchema | undefined {
  return toolSchema.oneOf?.find(schema => schema.properties?.action?.enum?.[0] === action)
}

describe('unified tools', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('rejects non-object tool arguments before routing', async () => {
    const tools = new UnifiedTools()

    await expect(tools.execute('scene_management', null)).resolves.toMatchObject({
      success: false,
      errorCode: 'TOOL_CONTRACT_ERROR',
      error: 'Tool scene_management requires an object argument',
      data: { toolName: 'scene_management', attempted: null, allowedProperties: ['action'] },
      metadata: { category: 'contract', allowed: ['action'] },
    })
  })

  it('rejects a missing action without calling a legacy tool', async () => {
    const tools = new UnifiedTools()

    await expect(tools.execute('scene_management', {})).resolves.toMatchObject({
      success: false,
      error: 'scene_management requires an action parameter',
    })
  })

  it('exposes registered tools through the registry action', async () => {
    const tools = new UnifiedTools()

    const result = await tools.execute('tool_registry', { action: 'describe', toolName: 'scene_management' })

    expect(result).toMatchObject({ success: true })
    expect(result.data).toMatchObject({
      name: 'scene_management',
      inputSchema: {
        required: ['action'],
      },
      actions: expect.arrayContaining([
        expect.objectContaining({
          name: 'open',
          required: ['scenePath'],
          properties: ['scenePath'],
          example: { action: 'open', scenePath: 'db://assets/scenes/Main.scene' },
        }),
      ]),
    })
  })

  it('generates action-specific schemas for ActionSpec tools', () => {
    const tools = new UnifiedTools()
    const sceneManagement = tools.getTools().find(tool => tool.name === 'scene_management')
    const schemas = sceneManagement?.inputSchema.oneOf ?? []
    const openSchema = schemas.find(schema => schema.properties?.action?.enum?.[0] === 'open')
    const saveSchema = schemas.find(schema => schema.properties?.action?.enum?.[0] === 'save')

    expect(openSchema).toMatchObject({
      required: ['action', 'scenePath'],
      properties: { scenePath: expect.any(Object) },
      additionalProperties: false,
    })
    expect(saveSchema).toMatchObject({
      required: ['action'],
      properties: { action: { enum: ['save'] } },
      additionalProperties: false,
    })
  })

  it('generates action-specific schemas for query and component tools', () => {
    const tools = new UnifiedTools()
    const nodeQuery = tools.getTools().find(tool => tool.name === 'node_query')
    const componentQuery = tools.getTools().find(tool => tool.name === 'component_query')
    const assetQuery = tools.getTools().find(tool => tool.name === 'asset_query')

    const nodeInfo = nodeQuery?.inputSchema.oneOf?.find(schema => schema.properties?.action?.enum?.[0] === 'get_info')
    const componentInfo = componentQuery?.inputSchema.oneOf?.find(schema => schema.properties?.action?.enum?.[0] === 'get_info')
    const assetUrl = assetQuery?.inputSchema.oneOf?.find(schema => schema.properties?.action?.enum?.[0] === 'query_url')

    expect(nodeInfo).toMatchObject({ required: ['action', 'uuid'], additionalProperties: false })
    expect(componentInfo).toMatchObject({ required: ['action', 'nodeUuid', 'componentType'], additionalProperties: false })
    expect(assetUrl).toMatchObject({ required: ['action', 'uuid'], additionalProperties: false })
  })

  it('generates action-specific schemas for asset and prefab tools', () => {
    const tools = new UnifiedTools()
    const assetQuery = tools.getTools().find(tool => tool.name === 'asset_query')
    const assetManage = tools.getTools().find(tool => tool.name === 'asset_manage')
    const prefabInstance = tools.getTools().find(tool => tool.name === 'prefab_instance')

    const queryUrl = assetQuery?.inputSchema.oneOf?.find(schema => schema.properties?.action?.enum?.[0] === 'query_url')
    const createSpriteFrame = assetManage?.inputSchema.oneOf?.find(schema => schema.properties?.action?.enum?.[0] === 'create_default_spriteframe')
    const instantiate = prefabInstance?.inputSchema.oneOf?.find(schema => schema.properties?.action?.enum?.[0] === 'instantiate')

    expect(queryUrl).toMatchObject({ required: ['action', 'uuid'], additionalProperties: false })
    expect(createSpriteFrame).toMatchObject({ required: ['action'], additionalProperties: false })
    expect(instantiate).toMatchObject({ required: ['action', 'prefabPath'], additionalProperties: false })
  })

  it('generates action-specific schemas for batch and component event tools', () => {
    const tools = new UnifiedTools()
    const assetBatch = tools.getTools().find(tool => tool.name === 'asset_batch')
    const eventBinding = tools.getTools().find(tool => tool.name === 'component_event_binding')

    const batchDelete = assetBatch?.inputSchema.oneOf?.find(schema => schema.properties?.action?.enum?.[0] === 'batch_delete')
    const appendEvent = eventBinding?.inputSchema.oneOf?.find(schema => schema.properties?.action?.enum?.[0] === 'append_button_event')

    expect(batchDelete).toMatchObject({ required: ['action', 'urls'], additionalProperties: false })
    expect(appendEvent).toMatchObject({ required: ['action', 'nodeUuid', 'targetNodeUuid', 'component', 'handler'], additionalProperties: false })
  })

  it('generates action-specific schemas for scene-control tools', () => {
    const tools = new UnifiedTools()
    const sceneExecution = tools.getTools().find(tool => tool.name === 'scene_execution_control')
    const sceneView = tools.getTools().find(tool => tool.name === 'scene_view_control')
    const sceneQuery = tools.getTools().find(tool => tool.name === 'scene_query')

    const executeMethod = sceneExecution?.inputSchema.oneOf?.find(schema => schema.properties?.action?.enum?.[0] === 'execute_component_method')
    const changeViewMode = sceneView?.inputSchema.oneOf?.find(schema => schema.properties?.action?.enum?.[0] === 'change_view_mode')
    const nodesByAsset = sceneQuery?.inputSchema.oneOf?.find(schema => schema.properties?.action?.enum?.[0] === 'nodes_by_asset_uuid')

    expect(executeMethod).toMatchObject({ required: ['action', 'uuid', 'name'], additionalProperties: false })
    expect(changeViewMode).toMatchObject({ required: ['action', 'is2D'], additionalProperties: false })
    expect(nodesByAsset).toMatchObject({ required: ['action', 'assetUuid'], additionalProperties: false })
  })

  it('generates action-specific schemas for diagnostics and utility tools', async () => {
    const tools = new UnifiedTools()
    const debugLogs = tools.getTools().find(tool => tool.name === 'debug_logs')
    const preferences = tools.getTools().find(tool => tool.name === 'preferences_manage')
    const referenceImages = tools.getTools().find(tool => tool.name === 'reference_image_manage')
    const debugSearch = debugLogs?.inputSchema.oneOf?.find(schema => schema.properties?.action?.enum?.[0] === 'search')
    const preferenceSet = preferences?.inputSchema.oneOf?.find(schema => schema.properties?.action?.enum?.[0] === 'set')
    const referencePosition = referenceImages?.inputSchema.oneOf?.find(schema => schema.properties?.action?.enum?.[0] === 'set_position')

    expect(debugSearch).toMatchObject({ required: ['action', 'pattern'], additionalProperties: false })
    expect(preferenceSet).toMatchObject({ required: ['action', 'name', 'path', 'value'], additionalProperties: false })
    expect(referencePosition).toMatchObject({ required: ['action', 'x', 'y'], additionalProperties: false })

    const registry = await tools.execute('tool_registry', { action: 'describe', toolName: 'debug_execute' })
    expect(registry.data).toMatchObject({
      actions: [expect.objectContaining({ name: 'script', status: 'unsupported' })],
    })
  })

  it('rejects unsupported, missing, and action-mismatched arguments from ActionSpec', async () => {
    const tools = new UnifiedTools()

    await expect(tools.execute('scene_management', { action: 'open', path: 'db://assets/Main.scene' })).resolves.toMatchObject({
      success: false,
      errorCode: 'TOOL_CONTRACT_ERROR',
      error: expect.stringContaining('does not accept: path'),
      data: {
        attempted: { action: 'open', path: 'db://assets/Main.scene' },
        allowedProperties: ['action', 'scenePath'],
      },
      instruction: expect.stringContaining('scenePath'),
      metadata: {
        category: 'contract',
        retryable: true,
        nextTool: 'tool_registry',
        nextAction: 'describe',
        retryWith: { toolName: 'scene_management', action: 'open' },
        attempted: { action: 'open', path: 'db://assets/Main.scene' },
        allowed: ['action', 'scenePath'],
      },
    })
    await expect(tools.execute('scene_management', { action: 'open' })).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('requires: scenePath'),
    })
    await expect(tools.execute('scene_undo_manage', { action: 'begin' })).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('requires one of: nodeUuid or nodeUuids'),
    })
  })

  it('keeps every public ActionSpec schema, registry contract, examples, and dispatch guard aligned', async () => {
    const tools = new UnifiedTools()

    for (const tool of tools.getTools()) {
      const result = await tools.execute('tool_registry', { action: 'describe', toolName: tool.name })
      expect(result.success, `${tool.name} should be describable`).toBe(true)

      const contract = result.data as { actions?: RegistryAction[], inputSchema?: JsonSchema }
      const actions = contract.actions ?? []
      const supported = actions.filter(action => action.status !== 'unsupported')
      const supportedNames = supported.map(action => action.name)
      const publicActionNames = tool.inputSchema.properties?.action?.enum ?? []
      const branches = tool.inputSchema.oneOf ?? []

      expect(publicActionNames, `${tool.name} action enum`).toEqual(supportedNames)
      expect(branches.map(branch => branch.properties?.action?.enum?.[0]), `${tool.name} oneOf actions`).toEqual(supportedNames)
      expect(tool.description, `${tool.name} description action summary`).toContain(`Actions: ${supportedNames.length > 0 ? supportedNames.join(', ') : 'none (inspect tool_registry.describe for legacy compatibility metadata)'}.`)

      const propertyNames = new Set(Object.keys(tool.inputSchema.properties ?? {}).filter(name => name !== 'action'))
      const branchPropertyNames = new Set<string>()
      for (const action of actions) {
        expect(action.description, `${tool.name}.${action.name} description`).not.toBe('')
        expect(action.properties, `${tool.name}.${action.name} properties`).toEqual(expect.any(Array))
        expect(action.required, `${tool.name}.${action.name} required`).toEqual(expect.any(Array))

        if (action.status === 'unsupported') {
          expect(publicActionNames, `${tool.name}.${action.name} must not be public`).not.toContain(action.name)
          expect(action.unsupportedReason, `${tool.name}.${action.name} unsupported reason`).toEqual(expect.any(String))
          continue
        }

        const branch = getActionSchema(tool.inputSchema, action.name)
        expect(branch, `${tool.name}.${action.name} schema branch`).toBeDefined()
        expect(branch?.additionalProperties, `${tool.name}.${action.name} rejects mixed parameters`).toBe(false)
        expect(branch?.required, `${tool.name}.${action.name} required fields`).toEqual(['action', ...action.required])
        expect(branch?.properties?.action?.enum, `${tool.name}.${action.name} action discriminator`).toEqual([action.name])

        for (const property of action.properties) {
          propertyNames.add(property)
          branchPropertyNames.add(property)
          expect(branch?.properties).toHaveProperty(property)
        }
        expect(branch?.anyOf).toEqual(action.requiredAnyOf?.map(required => ({ required })) ?? undefined)

        if (action.example) {
          expect(action.example.action, `${tool.name}.${action.name} example action`).toBe(action.name)
          expect(Object.keys(action.example).every(key => key === 'action' || action.properties.includes(key)), `${tool.name}.${action.name} example fields`).toBe(true)
          expect(action.required.every(key => Object.hasOwn(action.example!, key)), `${tool.name}.${action.name} example required fields`).toBe(true)
          expect(action.requiredAnyOf?.some(group => group.every(key => Object.hasOwn(action.example!, key))) ?? true, `${tool.name}.${action.name} example requiredAnyOf`).toBe(true)
        }

        const guard = await tools.execute(tool.name, { action: action.name, __contractProbe: true })
        expect(guard, `${tool.name}.${action.name} must be recognized before routing`).toMatchObject({
          success: false,
          error: expect.stringContaining(`does not accept: __contractProbe`),
        })
      }
      expect(propertyNames, `${tool.name} flat compatibility properties`).toEqual(new Set([...branchPropertyNames]))
    }
  })

  it('dispatches every supported action example beyond the public contract guard', async () => {
    const calls: Array<{ prefix: LegacyPrefix, operation: string, args: unknown }> = []
    const prefixes: LegacyPrefix[] = [
      'sceneAdvanced',
      'sceneView',
      'referenceImage',
      'assetAdvanced',
      'validation',
      'scene',
      'node',
      'component',
      'prefab',
      'project',
      'debug',
      'preferences',
      'server',
      'broadcast',
    ]
    const overrides = Object.fromEntries(prefixes.map(prefix => [
      prefix,
      {
        getTools: () => [],
        execute: async (operation: string, args: unknown) => {
          calls.push({ prefix, operation, args })
          return { success: true, data: { operation, args } }
        },
      } satisfies ToolExecutor,
    ])) as LegacyExecutorOverrides
    vi.stubGlobal('Editor', {
      Message: { request: vi.fn(async () => null) },
    })
    const tools = new UnifiedTools({}, overrides)

    let exampleCount = 0
    for (const tool of tools.getTools()) {
      const registry = await tools.execute('tool_registry', { action: 'describe', toolName: tool.name })
      const actions = ((registry.data as { actions?: RegistryAction[] }).actions ?? [])
        .filter(action => action.status !== 'unsupported' && action.example)

      for (const action of actions) {
        exampleCount += 1
        const callCount = calls.length
        const result = await tools.execute(tool.name, action.example)
        expect(result.errorCode, `${tool.name}.${action.name} example must pass the contract`).not.toBe('TOOL_CONTRACT_ERROR')
        if (calls.length > callCount) {
          expect(calls.at(-1)?.args, `${tool.name}.${action.name} legacy payload`).toEqual(
            Object.fromEntries(Object.entries(action.example!).filter(([key]) => key !== 'action')),
          )
        }
      }
    }

    expect(exampleCount).toBeGreaterThan(0)
    expect(calls.length).toBeGreaterThan(0)
  })

  it('hides legacy asset wrappers while keeping them directly callable and describable', async () => {
    const tools = new UnifiedTools()
    const publicNames = tools.getTools().map(tool => tool.name)

    expect(publicNames).not.toContain('project_query')
    expect(publicNames).not.toContain('project_asset_system')
    await expect(tools.execute('tool_registry', { action: 'list' })).resolves.toMatchObject({
      success: true,
      data: {
        tools: expect.not.arrayContaining([
          expect.objectContaining({ name: 'project_query' }),
          expect.objectContaining({ name: 'project_asset_system' }),
        ]),
      },
    })
    await expect(tools.execute('tool_registry', { action: 'actions' })).resolves.toEqual(expect.objectContaining({
      success: true,
      data: expect.not.arrayContaining([
        expect.objectContaining({ name: 'project_query' }),
        expect.objectContaining({ name: 'project_asset_system' }),
      ]),
    }))
    await expect(tools.execute('tool_registry', { action: 'describe', toolName: 'project_query' })).resolves.toMatchObject({
      success: true,
      data: { name: 'project_query' },
    })
    await expect(tools.execute('project_query', { action: 'asset_url', uuid: 'missing-uuid' })).resolves.toMatchObject({
      success: false,
      errorCode: 'TOOL_ASSET_ERROR',
    })
  })

  it('resolves an asset identity from either URL or UUID through one action', async () => {
    const request = vi.fn(async (_channel: string, method: string, value: string) => {
      if (method === 'query-url')
        return 'db://assets/player.png'
      if (method === 'query-uuid')
        return 'asset-uuid'
      if (method === 'query-path')
        return '/project/assets/player.png'
      return null
    })
    vi.stubGlobal('Editor', { Message: { request } })
    const tools = new UnifiedTools()

    await expect(tools.execute('asset_query', {
      action: 'resolve_identity',
      urlOrUUID: 'asset-uuid',
    })).resolves.toMatchObject({
      success: true,
      data: {
        input: 'asset-uuid',
        url: 'db://assets/player.png',
        uuid: 'asset-uuid',
        path: '/project/assets/player.png',
      },
    })
    expect(request).toHaveBeenCalledWith('asset-db', 'query-url', 'asset-uuid')
    expect(request).toHaveBeenCalledWith('asset-db', 'query-uuid', 'db://assets/player.png')
    expect(request).toHaveBeenCalledWith('asset-db', 'query-path', 'db://assets/player.png')
  })

  it('routes public asset identifiers to the legacy asset database contract', async () => {
    const request = vi.fn(async (_channel: string, method: string, value: string) => {
      if (method === 'query-url')
        return 'db://assets/player.png'
      if (method === 'query-asset-info') {
        return {
          name: 'player.png',
          uuid: 'asset-uuid',
          url: value,
          type: 'cc.Texture2D',
          isDirectory: false,
        }
      }
      if (method === 'query-uuid')
        return 'asset-uuid'
      return null
    })
    vi.stubGlobal('Editor', { Message: { request } })
    const tools = new UnifiedTools()

    await expect(tools.execute('asset_query', {
      action: 'details',
      urlOrUUID: 'asset-uuid',
      includeSubAssets: false,
    })).resolves.toMatchObject({
      success: true,
      data: { urlOrUUID: 'asset-uuid', assetUrl: 'db://assets/player.png' },
    })
    await expect(tools.execute('project_query', {
      action: 'asset_details',
      urlOrUUID: 'db://assets/player.png',
      includeSubAssets: false,
    })).resolves.toMatchObject({ success: true })
    await expect(tools.execute('asset_query', {
      action: 'query_uuid',
      url: 'db://assets/player.png',
    })).resolves.toMatchObject({ success: true, data: { uuid: 'asset-uuid' } })

    expect(request).toHaveBeenCalledWith('asset-db', 'query-url', 'asset-uuid')
    expect(request).toHaveBeenCalledWith('asset-db', 'query-asset-info', 'db://assets/player.png')
    expect(request).toHaveBeenCalledWith('asset-db', 'query-uuid', 'db://assets/player.png')
  })

  it('accepts overwrite for imports and hides unavailable asset operations', async () => {
    const tools = new UnifiedTools()
    const assetManage = tools.getTools().find(tool => tool.name === 'asset_manage')
    const assetAnalyze = tools.getTools().find(tool => tool.name === 'asset_analyze')
    const assetBatch = tools.getTools().find(tool => tool.name === 'asset_batch')
    const resourceReference = tools.getTools().find(tool => tool.name === 'resource_reference')
    const preferences = tools.getTools().find(tool => tool.name === 'preferences_manage')

    const importSchema = getActionSchema(assetManage!.inputSchema, 'import')
    expect(importSchema).toMatchObject({
      properties: { overwrite: { type: 'boolean' } },
      required: ['action', 'sourcePath', 'targetFolder'],
    })
    await expect(tools.execute('asset_manage', {
      action: 'import',
      sourcePath: '/definitely/missing/player.png',
      targetFolder: 'db://assets/textures',
      overwrite: true,
    })).resolves.toMatchObject({
      success: false,
      errorCode: 'TOOL_ASSET_ERROR',
      error: 'Source file not found',
      metadata: {
        category: 'asset',
        attempted: {
          action: 'import',
          sourcePath: '/definitely/missing/player.png',
          targetFolder: 'db://assets/textures',
          overwrite: true,
        },
      },
    })

    expect(assetAnalyze?.inputSchema.properties?.action?.enum).toEqual(['validate_references'])
    expect(assetBatch?.inputSchema.properties?.action?.enum).not.toContain('compress_textures')
    expect(resourceReference?.inputSchema.properties?.action?.enum).not.toContain('asset_dependencies')
    expect(preferences?.inputSchema.properties?.action?.enum).not.toContain('import')
  })

  it('describes action-specific undo requirements', () => {
    const tools = new UnifiedTools()
    const undo = tools.getTools().find(tool => tool.name === 'scene_undo_manage')
    const begin = undo?.inputSchema.oneOf?.find(schema => schema.properties?.action?.enum?.[0] === 'begin')
    const end = undo?.inputSchema.oneOf?.find(schema => schema.properties?.action?.enum?.[0] === 'end')
    const cancel = undo?.inputSchema.oneOf?.find(schema => schema.properties?.action?.enum?.[0] === 'cancel')

    expect(undo?.inputSchema.properties).toHaveProperty('undoId')
    expect(undo?.inputSchema.properties).toHaveProperty('nodeUuids')
    expect(undo?.inputSchema.properties).toHaveProperty('label')
    expect(begin).toMatchObject({
      required: ['action'],
      additionalProperties: false,
      anyOf: [{ required: ['nodeUuid'] }, { required: ['nodeUuids'] }],
    })
    expect(end).toMatchObject({ required: ['action', 'undoId'], additionalProperties: false })
    expect(cancel).toMatchObject({ required: ['action', 'undoId'], additionalProperties: false })
  })

  it('describes action-specific scene execution requirements', () => {
    const tools = new UnifiedTools()
    const execution = tools.getTools().find(tool => tool.name === 'scene_execution_control')

    expect(execution?.description).toContain('For execute_component_method, `uuid` (the component instance UUID) and `name` (the component method name) are required.')
    expect(execution?.inputSchema.oneOf).toEqual(expect.arrayContaining([
      expect.objectContaining({
        properties: expect.objectContaining({ action: { type: 'string', enum: ['execute_component_method'] } }),
        required: ['action', 'uuid', 'name'],
      }),
      expect.objectContaining({
        properties: expect.objectContaining({ action: { type: 'string', enum: ['execute_scene_script'] } }),
        required: ['action', 'name', 'method'],
      }),
      expect.objectContaining({
        properties: expect.objectContaining({ action: { type: 'string', enum: ['restore_prefab'] } }),
        required: ['action', 'nodeUuid', 'assetUuid'],
      }),
      expect.objectContaining({
        properties: expect.objectContaining({ action: { type: 'string', enum: ['soft_reload'] } }),
        required: ['action'],
      }),
      expect.objectContaining({
        properties: expect.objectContaining({ action: { type: 'string', enum: ['query_ready'] } }),
        required: ['action'],
      }),
      expect.objectContaining({
        properties: expect.objectContaining({ action: { type: 'string', enum: ['query_dirty'] } }),
        required: ['action'],
      }),
    ]))
  })

  it('keeps unified tool contracts aligned with supported runtime capabilities', () => {
    const tools = new UnifiedTools()
    const sceneManagement = tools.getTools().find(tool => tool.name === 'scene_management')
    const componentProperty = tools.getTools().find(tool => tool.name === 'component_property')
    const runtime = tools.getTools().find(tool => tool.name === 'project_runtime')
    const projectManage = tools.getTools().find(tool => tool.name === 'project_manage')

    expect(sceneManagement?.inputSchema.properties).not.toHaveProperty('path')
    expect(componentProperty?.description).toContain('Camera node UUID')
    expect(componentProperty?.description).toContain('camera-node-or-component-uuid')
    expect(runtime?.inputSchema.properties?.action).toMatchObject({ enum: ['run'] })
    expect(runtime?.description).toContain('Project > Preview')
    expect(projectManage?.description).toContain('{"action":"refresh_assets"')
  })

  it('describes 3D component property and runtime limitations explicitly', () => {
    const tools = new UnifiedTools()
    const componentProperty = tools.getTools().find(tool => tool.name === 'component_property')
    const build = tools.getTools().find(tool => tool.name === 'project_build_system')
    const runtime = tools.getTools().find(tool => tool.name === 'project_runtime')
    const performance = tools.getTools().find(tool => tool.name === 'debug_performance')

    expect(componentProperty?.description).toContain('sharedMaterials')
    expect(componentProperty?.inputSchema.properties?.propertyType).toMatchObject({ description: expect.stringContaining('Property value type') })
    expect(build?.description).toContain('there is no get_config action')
    expect(runtime?.description).toContain('Project > Preview')
    expect(performance?.description).toContain('not `get_stats`')
  })
  it('rejects arbitrary debug scripts with actionable guidance', async () => {
    const tools = new UnifiedTools()

    await expect(tools.execute('debug_execute', { action: 'script', script: 'Editor.Message.request()' })).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('Action \'script\' is unsupported'),
      data: expect.objectContaining({ reason: expect.stringContaining('Arbitrary JavaScript execution is not supported') }),
      instruction: expect.stringContaining('asset_query/project_query'),
    })
  })

  it('explains that scene scripts must be registered methods', async () => {
    vi.stubGlobal('Editor', {
      Message: {
        request: vi.fn().mockRejectedValue(new Error('Scenario scripts do not exist: set-sprite-frame')),
      },
    })
    const tools = new UnifiedTools()

    await expect(tools.execute('scene_execution_control', {
      action: 'execute_scene_script',
      name: 'set-sprite-frame',
      method: 'setSpriteFrame',
    })).resolves.toMatchObject({
      success: false,
      instruction: expect.stringContaining('cannot run arbitrary JavaScript'),
    })
  })
})
