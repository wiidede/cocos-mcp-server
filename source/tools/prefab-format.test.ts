import { describe, expect, it } from 'vitest'
import { createColor, createPrefabMeta, createSize, createVec3, extractPrefabValue, generateFileId, generateUuid, getComponentPropertyValue, isSerializedScriptClassId, parsePrefabDocument, shouldCopyComponentProperty, uuidToCompressedId, validatePrefabFormat } from './prefab-format'

describe('prefab format helpers', () => {
  it('generates deterministic identifiers with injected randomness', () => {
    expect(generateUuid(() => 0)).toBe('00000000-0000-0000-0000-000000000000')
    expect(generateFileId(() => 0)).toBe('a'.repeat(22))
    expect(uuidToCompressedId('invalid')).toBe('invalid')
    expect(uuidToCompressedId('00000000-0000-0000-0000-000000000000')).toHaveLength(23)
  })

  it('validates prefab roots and counts nodes and components', () => {
    expect(validatePrefabFormat({})).toMatchObject({ isValid: false, nodeCount: 0 })
    expect(validatePrefabFormat([{ __type__: 'cc.Prefab' }, { __type__: 'cc.Node' }, { __type__: 'cc.Sprite', node: { __id__: 1 } }])).toEqual({ isValid: true, issues: [], nodeCount: 1, componentCount: 1 })
  })

  it('rejects custom component class names and missing scripts', () => {
    const base = [{ __type__: 'cc.Prefab' }, { __type__: 'cc.Node' }]
    expect(validatePrefabFormat([...base, { __type__: 'TitleScreen', node: { __id__: 1 } }])).toMatchObject({
      isValid: false,
      issues: [expect.stringContaining('\'TitleScreen\'')],
    })
    expect(validatePrefabFormat([...base, { __type__: 'cc.MissingScript', node: { __id__: 1 } }])).toMatchObject({
      isValid: false,
      issues: [expect.stringContaining('cc.MissingScript')],
    })
    expect(validatePrefabFormat([...base, { __type__: '31d33yUSnFMT49oD/z9L/HB', node: { __id__: 1 } }])).toMatchObject({ isValid: true, componentCount: 1 })
    expect(isSerializedScriptClassId('31d33yUSnFMT49oD/z9L/HB')).toBe(true)
    expect(isSerializedScriptClassId('TitleScreen')).toBe(false)
  })

  it('extracts dump values from supported component locations', () => {
    const component = { direct: { value: 1 }, value: { nested: { value: 2 } }, _legacy: 3 }
    expect(extractPrefabValue({ value: 4 })).toBe(4)
    expect(getComponentPropertyValue(component, 'direct')).toBe(1)
    expect(getComponentPropertyValue(component, 'nested')).toBe(2)
    expect(getComponentPropertyValue(component, 'legacy')).toBe(3)
  })

  it('builds value types without replacing valid zeros', () => {
    expect(createVec3({ x: 0, y: 2, z: 3 })).toEqual({ __type__: 'cc.Vec3', x: 0, y: 2, z: 3 })
    expect(createSize({ width: 0 })).toEqual({ __type__: 'cc.Size', width: 0, height: 100 })
    expect(createColor({ a: 0 })).toMatchObject({ r: 255, a: 0 })
    expect(shouldCopyComponentProperty('__type__', 'cc.Sprite')).toBe(false)
    expect(shouldCopyComponentProperty('color', {})).toBe(true)
  })

  it('creates the canonical prefab meta structure', () => {
    expect(createPrefabMeta('Player', 'uuid')).toMatchObject({ importer: 'prefab', uuid: 'uuid', userData: { syncNodeName: 'Player' } })
  })

  it('normalizes raw arrays and wrapped prefab documents', () => {
    expect(parsePrefabDocument('[{"__type__":"cc.Prefab"}]').data).toHaveLength(1)
    expect(parsePrefabDocument('{"data":[]}')).toEqual({ data: [] })
    expect(() => parsePrefabDocument('{}')).toThrow('data 数组')
  })
})
