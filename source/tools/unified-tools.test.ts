import type { JsonSchema, ToolExecutor } from '../types'
import type { LegacyExecutorOverrides, LegacyPrefix } from './unified-tools'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
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

function listTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const filePath = path.join(directory, entry)
    return statSync(filePath).isDirectory()
      ? listTypeScriptFiles(filePath)
      : filePath.endsWith('.ts') ? [filePath] : []
  })
}

describe('unified tools', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('rejects non-object tool arguments before routing', async () => {
    const tools = new UnifiedTools()

    await expect(tools.execute('scene_lifecycle', null)).resolves.toMatchObject({
      success: false,
      errorCode: 'TOOL_CONTRACT_ERROR',
      error: 'Tool scene_lifecycle requires an object argument',
      data: { toolName: 'scene_lifecycle', attempted: null, allowedProperties: ['action'] },
      metadata: { category: 'contract', allowed: ['action'] },
    })
  })

  it('rejects a missing action without calling a legacy tool', async () => {
    const tools = new UnifiedTools()

    await expect(tools.execute('scene_lifecycle', {})).resolves.toMatchObject({
      success: false,
      error: 'scene_lifecycle requires an action parameter',
      instruction: expect.stringContaining('tool_registry.describe'),
    })
  })

  it('exposes registered tools through the registry action', async () => {
    const tools = new UnifiedTools()

    const result = await tools.execute('tool_registry', { action: 'describe', toolName: 'scene_lifecycle' })

    expect(result).toMatchObject({ success: true })
    expect(result.data).toMatchObject({
      name: 'scene_lifecycle',
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
    const sceneManagement = tools.getTools().find(tool => tool.name === 'scene_lifecycle')
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

    const nodeInfo = nodeQuery?.inputSchema.oneOf?.find(schema => schema.properties?.action?.enum?.[0] === 'get')
    const componentInfo = componentQuery?.inputSchema.oneOf?.find(schema => schema.properties?.action?.enum?.[0] === 'get')
    const assetIdentity = assetQuery?.inputSchema.oneOf?.find(schema => schema.properties?.action?.enum?.[0] === 'resolve_identity')

    expect(nodeInfo).toMatchObject({ required: ['action', 'uuid'], additionalProperties: false })
    expect(componentInfo).toMatchObject({ required: ['action', 'nodeUuid', 'componentType'], additionalProperties: false })
    expect(assetIdentity).toMatchObject({ required: ['action', 'urlOrUUID'], additionalProperties: false })
  })

  it('generates action-specific schemas for asset and prefab tools', () => {
    const tools = new UnifiedTools()
    const assetQuery = tools.getTools().find(tool => tool.name === 'asset_query')
    const assetManage = tools.getTools().find(tool => tool.name === 'asset_lifecycle')
    const prefabInstance = tools.getTools().find(tool => tool.name === 'prefab_instance')

    const resolveIdentity = assetQuery?.inputSchema.oneOf?.find(schema => schema.properties?.action?.enum?.[0] === 'resolve_identity')
    const createSpriteFrame = assetManage?.inputSchema.oneOf?.find(schema => schema.properties?.action?.enum?.[0] === 'create_default_spriteframe')
    const instantiate = prefabInstance?.inputSchema.oneOf?.find(schema => schema.properties?.action?.enum?.[0] === 'instantiate')
    const restore = prefabInstance?.inputSchema.oneOf?.find(schema => schema.properties?.action?.enum?.[0] === 'restore')

    expect(resolveIdentity).toMatchObject({ required: ['action', 'urlOrUUID'], additionalProperties: false })
    expect(createSpriteFrame).toMatchObject({ required: ['action'], additionalProperties: false })
    expect(instantiate).toMatchObject({ required: ['action', 'prefabPath'], additionalProperties: false })
    expect(restore).toMatchObject({ required: ['action', 'nodeUuid', 'assetUuid'], additionalProperties: false })
    expect(prefabInstance?.inputSchema.properties?.action?.enum).not.toContain('restore_node')
  })

  it('generates action-specific schemas for batch and component event tools', () => {
    const tools = new UnifiedTools()
    const assetBatch = tools.getTools().find(tool => tool.name === 'asset_batch')
    const eventBinding = tools.getTools().find(tool => tool.name === 'component_event')

    const batchDelete = assetBatch?.inputSchema.oneOf?.find(schema => schema.properties?.action?.enum?.[0] === 'delete')
    const appendEvent = eventBinding?.inputSchema.oneOf?.find(schema => schema.properties?.action?.enum?.[0] === 'append')

    expect(batchDelete).toMatchObject({ required: ['action', 'urls'], additionalProperties: false })
    expect(appendEvent).toMatchObject({ required: ['action', 'nodeUuid', 'targetNodeUuid', 'component', 'handler'], additionalProperties: false })
  })

  it('generates action-specific schemas for scene-control tools', () => {
    const tools = new UnifiedTools()
    const sceneExecution = tools.getTools().find(tool => tool.name === 'scene_execution')
    const sceneView = tools.getTools().find(tool => tool.name === 'scene_view_control')
    const sceneQuery = tools.getTools().find(tool => tool.name === 'scene_query')
    const sceneHierarchy = tools.getTools().find(tool => tool.name === 'scene_hierarchy')
    const debugScene = tools.getTools().find(tool => tool.name === 'debug_scene')

    const executeMethod = sceneExecution?.inputSchema.oneOf?.find(schema => schema.properties?.action?.enum?.[0] === 'execute_component_method')
    const changeViewMode = sceneView?.inputSchema.oneOf?.find(schema => schema.properties?.action?.enum?.[0] === 'set_view_mode')
    const getTree = sceneHierarchy?.inputSchema.oneOf?.find(schema => schema.properties?.action?.enum?.[0] === 'get_tree')
    expect(executeMethod).toMatchObject({ required: ['action', 'uuid', 'name'], additionalProperties: false })
    expect(changeViewMode).toMatchObject({ required: ['action', 'is2D'], additionalProperties: false })
    expect(getTree?.properties).toHaveProperty('rootUuid')
    expect(getTree?.properties).toHaveProperty('maxDepth')
    expect(sceneQuery?.inputSchema.properties?.action?.enum).not.toContain('nodes_by_asset_uuid')
    expect(debugScene?.inputSchema.properties?.action?.enum).not.toContain('get_node_tree')
  })

  it('enforces normalized public tool and action names', async () => {
    const tools = new UnifiedTools()
    const definitions = tools.getTools()
    const publicNames = definitions.map(tool => tool.name)

    const digitActionExceptions = new Set(['set_icon_gizmo_3d', 'get_icon_gizmo_3d'])

    expect(publicNames).toHaveLength(45)
    expect(new Set(publicNames).size).toBe(publicNames.length)
    for (const tool of definitions) {
      expect(tool.name).toMatch(/^[a-z]+(?:_[a-z]+)*$/)
      expect(tool.name).not.toMatch(/_(?:manage|management|advanced|available|browse)$/)

      const registry = await tools.execute('tool_registry', { action: 'describe', toolName: tool.name })
      expect(registry.success).toBe(true)
      const actions = Array.isArray(registry.data?.actions) ? registry.data.actions : []
      expect(actions.length, `${tool.name} must expose at least one action`).toBeGreaterThan(0)
      for (const action of actions) {
        if (!digitActionExceptions.has(action.name))
          expect(action.name, `${tool.name} action`).toMatch(/^[a-z]+(?:_[a-z]+)*$/)
        expect(action.name, `${tool.name} action`).not.toMatch(/^query_/)
        expect(action.name, `${tool.name} action`).not.toMatch(/_list$/)
        expect(action.status, `${tool.name}.${action.name} must be supported`).not.toBe('unsupported')
      }
    }
  })

  it('keeps literal Dev Test Panel calls aligned with the public contract', () => {
    const definitions = new Map(new UnifiedTools().getTools().map(tool => [tool.name, tool]))
    const casesDirectory = path.resolve('source/panels/dev-test/cases')
    let callCount = 0
    let literalCallCount = 0

    for (const filePath of listTypeScriptFiles(casesDirectory)) {
      const source = readFileSync(filePath, 'utf8')
      const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true)
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node)
          && ts.isPropertyAccessExpression(node.expression)
          && node.expression.name.text === 'callTool'
          && node.arguments.length >= 2
          && ts.isStringLiteral(node.arguments[0])) {
          const toolName = node.arguments[0].text
          const input = node.arguments[1]
          callCount++
          if (ts.isObjectLiteralExpression(input)) {
            literalCallCount++
            const actionProperty = input.properties.find(property => ts.isPropertyAssignment(property)
              && ((ts.isIdentifier(property.name) && property.name.text === 'action')
                || (ts.isStringLiteral(property.name) && property.name.text === 'action')))
            expect(actionProperty, `${path.relative(casesDirectory, filePath)} must specify an action for ${toolName}`).toBeDefined()
            if (actionProperty && ts.isPropertyAssignment(actionProperty)) {
              expect(ts.isStringLiteral(actionProperty.initializer), `${path.relative(casesDirectory, filePath)} must use a literal action for ${toolName}`).toBe(true)
              if (ts.isStringLiteral(actionProperty.initializer)) {
                const action = actionProperty.initializer.text
                const definition = definitions.get(toolName)
                expect(definition, `${path.relative(casesDirectory, filePath)} references unknown tool ${toolName}`).toBeDefined()
                const actions = definition?.inputSchema.properties?.action?.enum ?? []
                expect(actions, `${path.relative(casesDirectory, filePath)} references unknown action ${toolName}.${action}`).toContain(action)
              }
            }
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(sourceFile)
    }

    expect(literalCallCount).toBeGreaterThan(0)
    expect(callCount - literalCallCount).toBe(2)
  })

  it('generates action-specific schemas for diagnostics and utility tools', async () => {
    const tools = new UnifiedTools()
    const debugLogs = tools.getTools().find(tool => tool.name === 'debug_logs')
    const preferences = tools.getTools().find(tool => tool.name === 'preferences')
    const referenceImages = tools.getTools().find(tool => tool.name === 'reference_image')
    const debugSearch = debugLogs?.inputSchema.oneOf?.find(schema => schema.properties?.action?.enum?.[0] === 'search')
    const preferenceSet = preferences?.inputSchema.oneOf?.find(schema => schema.properties?.action?.enum?.[0] === 'set')
    const referencePosition = referenceImages?.inputSchema.oneOf?.find(schema => schema.properties?.action?.enum?.[0] === 'set_position')

    expect(debugSearch).toMatchObject({ required: ['action', 'pattern'], additionalProperties: false })
    expect(preferenceSet).toMatchObject({ required: ['action', 'name', 'path', 'value'], additionalProperties: false })
    expect(referencePosition).toMatchObject({ required: ['action', 'x', 'y'], additionalProperties: false })
    expect(tools.getTools().map(tool => tool.name)).not.toContain('debug_execute')
  })

  it('rejects unsupported, missing, and action-mismatched arguments from ActionSpec', async () => {
    const tools = new UnifiedTools()

    await expect(tools.execute('scene_lifecycle', { action: 'open', path: 'db://assets/Main.scene' })).resolves.toMatchObject({
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
        retryWith: { toolName: 'scene_lifecycle', action: 'open' },
        attempted: { action: 'open', path: 'db://assets/Main.scene' },
        allowed: ['action', 'scenePath'],
      },
    })
    await expect(tools.execute('scene_lifecycle', { action: 'open' })).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('requires: scenePath'),
    })
    await expect(tools.execute('scene_undo', { action: 'begin' })).resolves.toMatchObject({
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

  it('removes legacy asset wrappers and exposes the normalized project query', async () => {
    const tools = new UnifiedTools()
    const publicNames = tools.getTools().map(tool => tool.name)

    expect(publicNames).not.toContain('project_asset_system')
    expect(publicNames.filter(name => name === 'project_query')).toHaveLength(1)
    await expect(tools.execute('tool_registry', { action: 'list_actions' })).resolves.toEqual(expect.objectContaining({
      success: true,
      data: expect.arrayContaining([
        expect.objectContaining({
          name: 'project_query',
          actions: [
            expect.objectContaining({ name: 'get_info' }),
            expect.objectContaining({ name: 'get_settings' }),
          ],
        }),
      ]),
    }))
    await expect(tools.execute('tool_registry', { action: 'describe', toolName: 'project_query' })).resolves.toMatchObject({
      success: true,
      data: { name: 'project_query' },
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
      action: 'get_details',
      urlOrUUID: 'asset-uuid',
      includeSubAssets: false,
    })).resolves.toMatchObject({
      success: true,
      data: { urlOrUUID: 'asset-uuid', assetUrl: 'db://assets/player.png' },
    })

    expect(request).toHaveBeenCalledWith('asset-db', 'query-url', 'asset-uuid')
    expect(request).toHaveBeenCalledWith('asset-db', 'query-asset-info', 'db://assets/player.png')
  })

  it('accepts overwrite for imports and hides unavailable asset operations', async () => {
    const tools = new UnifiedTools()
    const assetManage = tools.getTools().find(tool => tool.name === 'asset_lifecycle')
    const assetAnalyze = tools.getTools().find(tool => tool.name === 'asset_analyze')
    const assetBatch = tools.getTools().find(tool => tool.name === 'asset_batch')
    const resourceReference = tools.getTools().find(tool => tool.name === 'asset_reference')
    const preferences = tools.getTools().find(tool => tool.name === 'preferences')

    const importSchema = getActionSchema(assetManage!.inputSchema, 'import')
    expect(importSchema).toMatchObject({
      properties: { overwrite: { type: 'boolean' } },
      required: ['action', 'sourcePath', 'targetFolder'],
    })
    await expect(tools.execute('asset_lifecycle', {
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
    const undo = tools.getTools().find(tool => tool.name === 'scene_undo')
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
    const execution = tools.getTools().find(tool => tool.name === 'scene_execution')
    const lifecycle = tools.getTools().find(tool => tool.name === 'scene_lifecycle')
    const query = tools.getTools().find(tool => tool.name === 'scene_query')

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
    ]))
    expect(lifecycle?.inputSchema.properties?.action?.enum).toContain('soft_reload')
    expect(query?.inputSchema.properties?.action?.enum).toEqual(expect.arrayContaining(['check_ready', 'check_dirty']))
  })

  it('keeps unified tool contracts aligned with supported runtime capabilities', () => {
    const tools = new UnifiedTools()
    const sceneManagement = tools.getTools().find(tool => tool.name === 'scene_lifecycle')
    const componentProperty = tools.getTools().find(tool => tool.name === 'component_property')
    const runtime = tools.getTools().find(tool => tool.name === 'project_runtime')
    const assetLifecycle = tools.getTools().find(tool => tool.name === 'asset_lifecycle')

    expect(sceneManagement?.inputSchema.properties).not.toHaveProperty('path')
    expect(componentProperty?.description).toContain('Camera node UUID')
    expect(componentProperty?.description).toContain('camera-node-or-component-uuid')
    expect(runtime?.inputSchema.properties?.action).toMatchObject({ enum: ['run'] })
    expect(runtime?.description).toContain('Project > Preview')
    expect(assetLifecycle?.inputSchema.properties?.action?.enum).toContain('refresh')
  })

  it('describes 3D component property and runtime limitations explicitly', () => {
    const tools = new UnifiedTools()
    const componentProperty = tools.getTools().find(tool => tool.name === 'component_property')
    const build = tools.getTools().find(tool => tool.name === 'project_build')
    const runtime = tools.getTools().find(tool => tool.name === 'project_runtime')
    const performance = tools.getTools().find(tool => tool.name === 'debug_performance')

    expect(componentProperty?.description).toContain('sharedMaterials')
    expect(componentProperty?.inputSchema.properties?.propertyType).toMatchObject({ description: expect.stringContaining('Property value type') })
    expect(build?.description).toContain('there is no get_config action')
    expect(runtime?.description).toContain('Project > Preview')
    expect(performance?.description).toContain('only action is `get_stats`')
  })
  it('does not expose unsupported or duplicate public tools', () => {
    const tools = new UnifiedTools()
    const toolNames = tools.getTools().map(tool => tool.name)

    expect(toolNames).not.toContain('debug_execute')
    expect(toolNames).not.toContain('node_reference')
    expect(toolNames).not.toContain('prefab_reference')
    expect(tools.getTools().find(tool => tool.name === 'node_hierarchy')?.inputSchema.properties?.action?.enum).toEqual(['move'])
    expect(tools.getTools().find(tool => tool.name === 'component_property')?.inputSchema.properties?.action?.enum).toEqual(['set'])
    expect(tools.getTools().find(tool => tool.name === 'asset_reference')?.inputSchema.properties?.action?.enum).toEqual(['nodes_by_asset_uuid'])
  })

  it('explains that scene scripts must be registered methods', async () => {
    vi.stubGlobal('Editor', {
      Message: {
        request: vi.fn().mockRejectedValue(new Error('Scenario scripts do not exist: set-sprite-frame')),
      },
    })
    const tools = new UnifiedTools()

    await expect(tools.execute('scene_execution', {
      action: 'execute_scene_script',
      name: 'set-sprite-frame',
      method: 'setSpriteFrame',
    })).resolves.toMatchObject({
      success: false,
      instruction: expect.stringContaining('cannot run arbitrary JavaScript'),
    })
  })
})
