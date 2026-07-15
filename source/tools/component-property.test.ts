import { describe, expect, it } from 'vitest'
import { analyzeComponentProperty, inferComponentPropertyType, isScriptComponent, normalizeComponentName, normalizeComponentPropertyType, parseComponentColor, processComponentTypedValue } from './component-property'

describe('component property values', () => {
  it('parses six-digit hexadecimal colors with full opacity', () => {
    expect(parseComponentColor(' #FF0000 ')).toEqual({ r: 255, g: 0, b: 0, a: 255 })
  })

  it('parses eight-digit hexadecimal colors', () => {
    expect(parseComponentColor('#11223344')).toEqual({ r: 17, g: 34, b: 51, a: 68 })
  })

  it('rejects unsupported color formats', () => {
    expect(() => parseComponentColor('rgb(255, 0, 0)')).toThrow('Invalid color format')
    expect(() => parseComponentColor('#FF00ZZ')).toThrow('Invalid color format')
  })

  it('normalizes property type aliases and infers structured values', () => {
    expect(normalizeComponentPropertyType('cc.Vec3', null)).toBe('vec3')
    expect(normalizeComponentPropertyType('color_array', null)).toBe('colorArray')
    expect(inferComponentPropertyType({ x: 1, y: 2, z: 3 }, 'position', null)).toBe('vec3')
    expect(inferComponentPropertyType(['node-a'], 'targetNodes', null)).toBe('nodeArray')
  })

  it('converts typed values without editor dependencies', () => {
    expect(processComponentTypedValue('#01020304', 'color')).toEqual({ r: 1, g: 2, b: 3, a: 4 })
    expect(processComponentTypedValue({ x: '3', y: 4 }, 'vec2')).toEqual({ x: 3, y: 4 })
    expect(processComponentTypedValue('node-a', 'node')).toEqual({ uuid: 'node-a' })
  })

  it('analyzes Inspector property descriptors and reference metadata', () => {
    const result = analyzeComponentProperty({
      value: {
        target: {
          value: { uuid: 'node-a' },
          type: 'cc.Node',
        },
      },
    }, 'target')

    expect(result).toMatchObject({
      exists: true,
      type: 'node',
      originalValue: { uuid: 'node-a' },
      declaredType: 'cc.Node',
    })
    expect(result.availableProperties).toContain('target')
  })

  it('normalizes component names and matches script components exactly', () => {
    expect(normalizeComponentName({ value: { value: 'Player<MoveScript>' } })).toBe('Player<MoveScript>')
    expect(isScriptComponent({ name: 'Player<MoveScript>' }, 'MoveScript')).toBe(true)
    expect(isScriptComponent({ name: 'MoveScriptHelper' }, 'MoveScript')).toBe(false)
  })
})
