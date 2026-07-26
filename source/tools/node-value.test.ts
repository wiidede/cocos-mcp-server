import { describe, expect, it } from 'vitest'
import { inferNodeDumpType, is2DNodeInfo, normalizeNodeDumpValue, normalizeTransformValue } from './node-value'

describe('node value helpers', () => {
  it('infers value and reference dump types', () => {
    expect(inferNodeDumpType({ r: 0, g: 0, b: 0 }, 'color')).toBe('cc.Color')
    expect(normalizeNodeDumpValue({ __type__: 'Node', __id__: 2 }, 'target')).toEqual({ dumpValue: { uuid: 2 }, dumpType: 'cc.Node' })
  })

  it('normalizes 2D and 3D transforms', () => {
    expect(normalizeTransformValue({ x: 1, y: 2, z: 3 }, 'position', true)).toMatchObject({ value: { z: 0 } })
    expect(normalizeTransformValue({}, 'scale', false).value).toEqual({ x: 1, y: 1, z: 1 })
  })

  it('detects node dimensionality from components before position', () => {
    expect(is2DNodeInfo({ components: [{ type: 'cc.Sprite' }], position: { z: 9 } })).toBe(true)
    expect(is2DNodeInfo({ components: [{ type: 'cc.MeshRenderer' }], position: { z: 0 } })).toBe(false)
    expect(is2DNodeInfo({ components: [], position: { z: 0 } })).toBe(false)
  })
})
