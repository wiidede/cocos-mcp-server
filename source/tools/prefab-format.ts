export type PrefabRecord = Record<string, unknown>

export interface PrefabValidationResult {
  isValid: boolean
  issues: string[]
  nodeCount: number
  componentCount: number
}

export interface PrefabDocument {
  data: unknown[]
}

export function asPrefabRecord(value: unknown): PrefabRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as PrefabRecord : null
}

export function generateUuid(random: () => number = Math.random): string {
  const chars = '0123456789abcdef'
  let uuid = ''
  for (let index = 0; index < 32; index++) {
    if ([8, 12, 16, 20].includes(index))
      uuid += '-'
    uuid += chars[Math.floor(random() * chars.length)]
  }
  return uuid
}

export function generateFileId(random: () => number = Math.random): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/'
  return Array.from({ length: 22 }, () => chars[Math.floor(random() * chars.length)]).join('')
}

export function uuidToCompressedId(uuid: string): string {
  const keys = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/='
  const cleanUuid = uuid.replace(/-/g, '').toLowerCase()
  if (!/^[0-9a-f]{32}$/.test(cleanUuid))
    return uuid
  let result = cleanUuid.slice(0, 5)
  const remainder = cleanUuid.slice(5)
  for (let index = 0; index < remainder.length; index += 3) {
    const value = Number.parseInt(`${remainder[index] ?? '0'}${remainder[index + 1] ?? '0'}${remainder[index + 2] ?? '0'}`, 16)
    result += keys[(value >> 6) & 63] + keys[value & 63]
  }
  return result
}

export function isSerializedScriptClassId(value: string): boolean {
  return /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value)
    || /^[\da-f]{5}[A-Z0-9+/]{18}$/i.test(value)
}

export function validatePrefabFormat(prefabData: unknown): PrefabValidationResult {
  const issues: string[] = []
  if (!Array.isArray(prefabData))
    return { isValid: false, issues: ['预制体数据必须是数组格式'], nodeCount: 0, componentCount: 0 }
  if (prefabData.length === 0)
    return { isValid: false, issues: ['预制体数据为空'], nodeCount: 0, componentCount: 0 }

  const first = asPrefabRecord(prefabData[0])
  if (first?.__type__ !== 'cc.Prefab')
    issues.push('第一个元素必须是cc.Prefab类型')

  let nodeCount = 0
  let componentCount = 0
  for (const item of prefabData) {
    const record = asPrefabRecord(item)
    const type = record?.__type__
    if (type === 'cc.Node') {
      nodeCount++
    }
    else if (typeof type === 'string' && asPrefabRecord(record?.node)?.__id__ !== undefined) {
      componentCount++
      if (type === 'cc.MissingScript')
        issues.push('预制体包含 cc.MissingScript 组件')
      else if (!type.startsWith('cc.') && !isSerializedScriptClassId(type))
        issues.push(`自定义脚本组件必须使用 Cocos class ID 序列化，不能使用类名 '${type}'`)
    }
  }
  if (nodeCount === 0)
    issues.push('预制体必须包含至少一个节点')
  return { isValid: issues.length === 0, issues, nodeCount, componentCount }
}

export function extractPrefabValue(data: unknown): unknown {
  const record = asPrefabRecord(data)
  return record && Object.hasOwn(record, 'value') ? record.value : data
}

export function getComponentPropertyValue(componentData: unknown, propertyName: string, defaultValue?: unknown): unknown {
  const component = asPrefabRecord(componentData)
  if (!component)
    return defaultValue
  for (const source of [component, asPrefabRecord(component.value)]) {
    if (source && source[propertyName] !== undefined)
      return extractPrefabValue(source[propertyName])
  }
  const prefixedName = `_${propertyName}`
  return component[prefixedName] !== undefined ? extractPrefabValue(component[prefixedName]) : defaultValue
}

export function shouldCopyComponentProperty(key: string, value: unknown): boolean {
  return !key.startsWith('__') && key !== '_enabled' && key !== 'node' && key !== 'enabled' && typeof value !== 'function' && value !== undefined
}

function numericProperty(data: unknown, key: string, fallback: number): number {
  const value = asPrefabRecord(data)?.[key]
  return typeof value === 'number' ? value : fallback
}

export function createVec2(data: unknown): PrefabRecord {
  return { __type__: 'cc.Vec2', x: numericProperty(data, 'x', 0), y: numericProperty(data, 'y', 0) }
}

export function createVec3(data: unknown): PrefabRecord {
  return { ...createVec2(data), __type__: 'cc.Vec3', z: numericProperty(data, 'z', 0) }
}

export function createSize(data: unknown): PrefabRecord {
  return { __type__: 'cc.Size', width: numericProperty(data, 'width', 100), height: numericProperty(data, 'height', 100) }
}

export function createColor(data: unknown): PrefabRecord {
  return { __type__: 'cc.Color', r: numericProperty(data, 'r', 255), g: numericProperty(data, 'g', 255), b: numericProperty(data, 'b', 255), a: numericProperty(data, 'a', 255) }
}

export function createPrefabMeta(prefabName: string, prefabUuid: string): PrefabRecord {
  return {
    ver: '1.1.50',
    importer: 'prefab',
    imported: true,
    uuid: prefabUuid,
    files: ['.json'],
    subMetas: {},
    userData: { syncNodeName: prefabName },
  }
}

export function parsePrefabDocument(content: string): PrefabDocument {
  const parsed: unknown = JSON.parse(content)
  if (Array.isArray(parsed))
    return { data: parsed }
  const record = asPrefabRecord(parsed)
  if (Array.isArray(record?.data))
    return { data: record.data }
  throw new TypeError('预制体文件必须是对象数组或包含 data 数组')
}
