import { describe, expect, it } from 'vitest'
import { UnifiedTools } from './unified-tools'

describe('unified tools', () => {
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
})
