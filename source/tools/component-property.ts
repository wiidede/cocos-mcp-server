export interface ComponentColor {
  r: number
  g: number
  b: number
  a: number
}

export interface PropertyTypeContext {
  type?: string
}

export interface AnalyzedComponentProperty extends PropertyTypeContext {
  exists: boolean
  type: string
  availableProperties: string[]
  originalValue: unknown
  declaredType?: string
  declaredExtends?: string[]
  declaredPath?: string
  isArray?: boolean
}

export interface CanonicalAssetReference {
  uuid: string
  type?: string
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
}

export function isComponentPropertyDescriptor(value: unknown): boolean {
  const descriptor = record(value)
  if (!descriptor)
    return false
  const keys = Object.keys(descriptor)
  if (keys.every(key => ['number', 'string', 'boolean'].includes(typeof descriptor[key])))
    return false
  const hasValue = 'value' in descriptor
  const hasName = 'name' in descriptor
  return (hasValue || hasName) && ('type' in descriptor || 'displayName' in descriptor || 'readonly' in descriptor)
}

export function analyzeComponentProperty(component: unknown, propertyName: string): AnalyzedComponentProperty {
  const source = record(component) ?? {}
  const valueContainer = record(source.value)
  const propertiesContainer = record(source.properties)
  const propertyContainer = valueContainer ?? record(propertiesContainer?.value) ?? propertiesContainer ?? source
  const availableProperties: string[] = []
  let originalValue: unknown
  let exists = Object.hasOwn(source, propertyName)
  let declaredType: string | undefined
  let declaredExtends: string[] | undefined
  let declaredPath: string | undefined
  let isArray: boolean | undefined

  if (exists)
    originalValue = source[propertyName]
  for (const [key, descriptor] of Object.entries(propertyContainer)) {
    const descriptorRecord = record(descriptor)
    if (isComponentPropertyDescriptor(descriptor)) {
      availableProperties.push(key)
      if (key === propertyName) {
        exists = true
        originalValue = descriptorRecord?.value ?? descriptor
        declaredType = typeof descriptorRecord?.type === 'string' ? descriptorRecord.type : undefined
        declaredExtends = Array.isArray(descriptorRecord?.extends) && descriptorRecord.extends.every(item => typeof item === 'string')
          ? descriptorRecord.extends as string[]
          : undefined
        declaredPath = typeof descriptorRecord?.path === 'string' ? descriptorRecord.path : undefined
        isArray = typeof descriptorRecord?.isArray === 'boolean' ? descriptorRecord.isArray : undefined
      }
    }
    else if (valueContainer === propertyContainer && key === propertyName) {
      exists = true
      originalValue = descriptor
    }
  }

  if (availableProperties.length === 0) {
    for (const key of Object.keys(propertyContainer)) {
      if (key.startsWith('_') || ['__type__', 'cid', 'node', 'uuid', 'name', 'enabled', 'type', 'readonly', 'visible', 'editor', 'extends'].includes(key))
        continue
      availableProperties.push(key)
      if (!exists && key === propertyName) {
        exists = true
        originalValue = propertyContainer[key]
      }
    }
  }

  if (!exists)
    return { exists: false, type: 'unknown', availableProperties, originalValue: undefined }
  const isComponent = declaredType !== 'cc.Node' && declaredExtends?.includes('cc.Component')
  const declaredValueType = resolveDeclaredComponentValueType(declaredType)
  const type = isComponent
    ? 'component'
    : declaredValueType
      ?? (declaredExtends?.includes('cc.Asset')
        ? 'asset'
        : inferComponentPropertyType(originalValue, propertyName, null) ?? 'unknown')
  return { exists: true, type, availableProperties, originalValue, declaredType, declaredExtends, declaredPath, isArray }
}

export function resolveComponentPropertyPath(componentIndex: number, propertyName: string, declaredPath?: string): string {
  const path = declaredPath?.trim().replace(/^\.+/, '')
  if (!path)
    return `__comps__.${componentIndex}.${propertyName}`
  if (path.startsWith('__comps__.'))
    return path
  return `__comps__.${componentIndex}.${path}`
}

export function resolveDeclaredComponentValueType(declaredType: string | undefined): string | null {
  switch (declaredType?.toLowerCase()) {
    case 'cc.vec2': return 'vec2'
    case 'cc.vec3': return 'vec3'
    case 'cc.size': return 'size'
    case 'cc.color': return 'color'
    default: return null
  }
}

export function inferComponentPropertyType(value: unknown, propertyName: string, context: PropertyTypeContext | null): string | null {
  if (typeof value === 'string') {
    if (/^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value))
      return 'color'
    return context?.type === 'node' || context?.type === 'asset' ? context.type : 'string'
  }
  if (typeof value === 'number')
    return 'number'
  if (typeof value === 'boolean')
    return 'boolean'
  if (Array.isArray(value)) {
    if (value.length === 0)
      return 'stringArray'
    const first = value[0]
    if (typeof first === 'number')
      return 'numberArray'
    if (typeof first === 'string')
      return context?.type === 'nodeArray' || /node|target|child/i.test(propertyName) ? 'nodeArray' : 'stringArray'
    const firstRecord = record(first)
    return firstRecord && ('r' in firstRecord || 'g' in firstRecord || 'b' in firstRecord) ? 'colorArray' : 'stringArray'
  }
  const objectValue = record(value)
  if (!objectValue)
    return null
  if ('r' in objectValue || 'g' in objectValue || 'b' in objectValue)
    return 'color'
  if ('width' in objectValue || 'height' in objectValue)
    return 'size'
  if ('x' in objectValue && 'y' in objectValue && 'z' in objectValue)
    return 'vec3'
  if ('x' in objectValue && 'y' in objectValue)
    return 'vec2'
  if ('uuid' in objectValue || '__uuid__' in objectValue || '__id__' in objectValue) {
    if (context?.type === 'node' || context?.type === 'asset')
      return context.type
    return /node|target|child/i.test(propertyName) ? 'node' : 'asset'
  }
  return null
}

export function normalizeComponentPropertyType(rawType: string | undefined, value: unknown): string {
  if (!rawType || rawType.trim().toLowerCase() === 'auto')
    return inferComponentPropertyType(value, '', null) ?? 'auto'

  const aliases: Record<string, string> = {
    'color': 'color',
    'cc.color': 'color',
    'vec2': 'vec2',
    'cc.vec2': 'vec2',
    'vec3': 'vec3',
    'cc.vec3': 'vec3',
    'size': 'size',
    'cc.size': 'size',
    'number': 'number',
    'integer': 'integer',
    'int': 'integer',
    'float': 'float',
    'double': 'number',
    'boolean': 'boolean',
    'bool': 'boolean',
    'string': 'string',
    'str': 'string',
    'enum': 'enum',
    'object': 'object',
    'obj': 'object',
    'json': 'object',
    'cc.valuetype': 'object',
    'valuetype': 'object',
    'node': 'node',
    'cc.node': 'node',
    'component': 'component',
    'spriteframe': 'spriteFrame',
    'cc.spriteframe': 'spriteFrame',
    'prefab': 'prefab',
    'cc.prefab': 'prefab',
    'asset': 'asset',
    'array': 'array',
    'assetarray': 'assetArray',
    'assetArray': 'assetArray',
    'materialarray': 'assetArray',
    'materialArray': 'assetArray',
    'cc.material[]': 'assetArray',
    'nodearray': 'nodeArray',
    'nodeArray': 'nodeArray',
    'colorarray': 'colorArray',
    'colorArray': 'colorArray',
    'numberarray': 'numberArray',
    'numberArray': 'numberArray',
    'stringarray': 'stringArray',
    'stringArray': 'stringArray',
  }
  const lower = rawType.trim().toLowerCase()
  const camel = lower.replace(/[_-]([a-z])/g, (_match, letter: string) => letter.toUpperCase())
  return aliases[lower] || aliases[camel] || lower
}

export function resolveComponentAssetType(propertyName: string, propertyType: string, context: PropertyTypeContext & { declaredType?: string }): string {
  if (context.type === 'asset' && context.declaredType)
    return context.declaredType
  if (propertyType === 'prefab')
    return 'cc.Prefab'
  if (propertyType === 'spriteFrame')
    return 'cc.SpriteFrame'
  if (propertyName.toLowerCase().includes('texture'))
    return 'cc.Texture2D'
  if (propertyName.toLowerCase().includes('material'))
    return 'cc.Material'
  if (propertyName.toLowerCase().includes('font'))
    return 'cc.Font'
  if (propertyName.toLowerCase().includes('clip'))
    return 'cc.AudioClip'
  return 'cc.Asset'
}

export function resolveCanonicalAssetReference(assetInfo: unknown, expectedType: string): CanonicalAssetReference | null {
  const root = record(assetInfo)
  if (!root)
    return null

  const rawSubAssets = root.subAssets
  const subAssets = Array.isArray(rawSubAssets)
    ? rawSubAssets.map(record).filter((value): value is Record<string, unknown> => value !== null)
    : Object.values(record(rawSubAssets) ?? {}).map(record).filter((value): value is Record<string, unknown> => value !== null)
  const candidates = [root, ...subAssets]
  const matched = candidates.find((candidate) => {
    const type = typeof candidate.type === 'string' ? candidate.type : undefined
    const inheritedTypes = Array.isArray(candidate.extends) ? candidate.extends : []
    return expectedType === 'cc.Asset' || type === expectedType || inheritedTypes.includes(expectedType)
  })
  if (!matched || typeof matched.uuid !== 'string' || !matched.uuid)
    return null
  return {
    uuid: matched.uuid,
    type: typeof matched.type === 'string' ? matched.type : undefined,
  }
}

export function processComponentTypedValue(value: unknown, type: string): unknown {
  const objectValue = record(value)
  switch (type) {
    case 'string': return String(value)
    case 'number': case 'integer': case 'float': return Number(value)
    case 'boolean': return Boolean(value)
    case 'color': return typeof value === 'string'
      ? parseComponentColor(value)
      : {
          r: Math.min(255, Math.max(0, Number(objectValue?.r) || 0)),
          g: Math.min(255, Math.max(0, Number(objectValue?.g) || 0)),
          b: Math.min(255, Math.max(0, Number(objectValue?.b) || 0)),
          a: objectValue?.a === undefined ? 255 : Math.min(255, Math.max(0, Number(objectValue.a))),
        }
    case 'vec2': return { x: Number(objectValue?.x) || 0, y: Number(objectValue?.y) || 0 }
    case 'vec3': return { x: Number(objectValue?.x) || 0, y: Number(objectValue?.y) || 0, z: Number(objectValue?.z) || 0 }
    case 'size': return { width: Number(objectValue?.width) || 0, height: Number(objectValue?.height) || 0 }
    case 'node': case 'asset': case 'spriteFrame': case 'prefab': return typeof value === 'string' ? { uuid: value } : value
    default: return value
  }
}

export function normalizeComponentName(value: unknown): string {
  if (typeof value === 'string')
    return value
  const firstLevel = record(value)
  if (!firstLevel)
    return ''
  if (typeof firstLevel.value === 'string')
    return firstLevel.value
  const secondLevel = record(firstLevel.value)
  return typeof secondLevel?.value === 'string' ? secondLevel.value : ''
}

export function isScriptComponent(component: unknown, scriptName: string): boolean {
  const fields = record(component)
  if (!fields)
    return false
  const type = normalizeComponentName(fields.type)
  const name = normalizeComponentName(fields.name)
  const cid = normalizeComponentName(fields.cid)
  const internalType = normalizeComponentName(fields.__type__)
  return type === scriptName
    || internalType === scriptName
    || name === scriptName
    || name.endsWith(`<${scriptName}>`)
    || (cid !== 'cc.Script' && cid === scriptName)
}

export function buildUnsupportedComponentPropertyTypeError(rawType: string, value: unknown): string {
  const supported = ['color', 'vec2', 'vec3', 'size', 'number', 'string', 'boolean', 'enum', 'object', 'node', 'asset', 'assetArray', 'colorArray', 'numberArray', 'stringArray', 'nodeArray']
  return `Unsupported property type: "${rawType}".\n`
    + `propertyType is case-insensitive. Supported types: ${supported.join(', ')}.\n`
    + `Tip: if you omit propertyType, the value will be auto-detected from the JSON shape.\n`
    + `Received value: ${JSON.stringify(value)}`
}

export function parseComponentColor(color: string): ComponentColor {
  const value = color.trim()

  if (!value.startsWith('#')) {
    throw new Error(`Invalid color format: "${color}". Only hexadecimal format is supported (e.g., "#FF0000" or "#FF0000FF")`)
  }

  if (value.length !== 7 && value.length !== 9) {
    throw new Error(`Invalid color format: "${color}". Only hexadecimal format is supported (e.g., "#FF0000" or "#FF0000FF")`)
  }

  const r = Number.parseInt(value.substring(1, 3), 16)
  const g = Number.parseInt(value.substring(3, 5), 16)
  const b = Number.parseInt(value.substring(5, 7), 16)
  const a = value.length === 9 ? Number.parseInt(value.substring(7, 9), 16) : 255

  if ([r, g, b, a].some(Number.isNaN)) {
    throw new Error(`Invalid color format: "${color}". Only hexadecimal format is supported (e.g., "#FF0000" or "#FF0000FF")`)
  }

  return { r, g, b, a }
}
