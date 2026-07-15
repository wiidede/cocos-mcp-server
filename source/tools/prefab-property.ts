import { asPrefabRecord, createColor, createSize, createVec2, createVec3, uuidToCompressedId } from './prefab-format'

export interface PrefabReferenceContext {
  nodeUuidToIndex?: Map<string, number>
  componentUuidToIndex?: Map<string, number>
}

const assetTypes = new Set(['cc.Prefab', 'cc.Texture2D', 'cc.SpriteFrame', 'cc.Material', 'cc.AnimationClip', 'cc.AudioClip', 'cc.Font', 'cc.Asset'])

function referenceUuid(value: unknown): string | null {
  const uuid = asPrefabRecord(value)?.uuid
  return typeof uuid === 'string' && uuid.length > 0 ? uuid : null
}

function serializeReference(uuid: string, indexes: Map<string, number> | undefined): { __id__: number } | null {
  const index = indexes?.get(uuid)
  return index === undefined ? null : { __id__: index }
}

export function serializeComponentProperty(propertyData: unknown, context?: PrefabReferenceContext): unknown {
  const property = asPrefabRecord(propertyData)
  if (!property)
    return propertyData
  const value = property.value
  const type = typeof property.type === 'string' ? property.type : undefined
  if (value === null || value === undefined)
    return null

  const uuid = referenceUuid(value)
  if (uuid && type === 'cc.Node')
    return serializeReference(uuid, context?.nodeUuidToIndex)
  if (uuid && type && assetTypes.has(type)) {
    return { __uuid__: type === 'cc.Prefab' ? uuid : uuidToCompressedId(uuid), __expectedType__: type }
  }
  if (uuid && type?.startsWith('cc.'))
    return serializeReference(uuid, context?.componentUuidToIndex)

  if (Array.isArray(value)) {
    const elementType = asPrefabRecord(property.elementTypeData)?.type
    if (elementType === 'cc.Node')
      return value.map(item => referenceUuid(item)).filter((item): item is string => item !== null).map(item => serializeReference(item, context?.nodeUuidToIndex)).filter(item => item !== null)
    if (typeof elementType === 'string' && elementType.startsWith('cc.')) {
      return value.map(item => referenceUuid(item)).filter((item): item is string => item !== null).map(item => ({ __uuid__: uuidToCompressedId(item), __expectedType__: elementType }))
    }
    return value.map(item => asPrefabRecord(item)?.value ?? item)
  }

  if (type === 'cc.Color')
    return createColor(value)
  if (type === 'cc.Vec3')
    return createVec3(value)
  if (type === 'cc.Vec2')
    return createVec2(value)
  if (type === 'cc.Size')
    return createSize(value)
  if (type === 'cc.Quat') {
    const record = asPrefabRecord(value)
    const number = (key: string, fallback: number) => typeof record?.[key] === 'number' ? record[key] : fallback
    return { __type__: 'cc.Quat', x: number('x', 0), y: number('y', 0), z: number('z', 0), w: number('w', 1) }
  }
  if (type?.startsWith('cc.') && asPrefabRecord(value))
    return { __type__: type, ...asPrefabRecord(value) }
  return value
}
