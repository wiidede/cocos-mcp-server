import { afterEach, describe, expect, it, vi } from 'vitest'
import { UnifiedTools } from './unified-tools'

describe('unified tools', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('rejects non-object tool arguments before routing', async () => {
    const tools = new UnifiedTools()

    await expect(tools.execute('scene_management', null)).resolves.toMatchObject({
      success: false,
      error: 'Tool scene_management requires an object argument',
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
    })
  })

  it('describes action-specific undo requirements', () => {
    const tools = new UnifiedTools()
    const undo = tools.getTools().find(tool => tool.name === 'scene_undo_manage')

    expect(undo?.inputSchema.properties).toHaveProperty('undoId')
    expect(undo?.inputSchema.properties).toHaveProperty('nodeUuids')
    expect(undo?.inputSchema.properties).toHaveProperty('label')
    expect(undo?.inputSchema.anyOf).toEqual(expect.arrayContaining([
      expect.objectContaining({ required: ['action', 'nodeUuid'] }),
      expect.objectContaining({ required: ['action', 'nodeUuids'] }),
      expect.objectContaining({ required: ['action', 'undoId'] }),
    ]))
  })

  it('rejects arbitrary debug scripts with actionable guidance', async () => {
    const tools = new UnifiedTools()

    await expect(tools.execute('debug_execute', { action: 'script', script: 'Editor.Message.request()' })).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('Arbitrary JavaScript execution is not supported'),
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
