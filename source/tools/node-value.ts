type UnknownRecord = Record<string, unknown>
export type TransformType = 'position' | 'rotation' | 'scale'

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as UnknownRecord : null
}

export function inferNodeDumpType(value: unknown, propertyName: string): string | undefined {
  const record = asRecord(value)
  if (!record)
    return undefined
  const keys = Object.keys(record)
  if (keys.some(key => ['uuid', '__uuid__', '__id__'].includes(key)))
    return /node|target|child|parent|root/i.test(propertyName) ? 'cc.Node' : 'cc.Asset'
  if (keys.some(key => ['r', 'g', 'b'].includes(key)))
    return 'cc.Color'
  if (keys.includes('width') && keys.includes('height'))
    return 'cc.Size'
  if (keys.includes('x') && keys.includes('y') && keys.includes('z'))
    return 'cc.Vec3'
  if (keys.includes('x') && keys.includes('y'))
    return 'cc.Vec2'
  return undefined
}

export function normalizeNodeDumpValue(value: unknown, propertyName: string): { dumpValue: unknown, dumpType?: string } {
  const record = asRecord(value)
  if (!record)
    return { dumpValue: value }
  const reference = record.uuid ?? record.__id__ ?? record.__uuid__
  if (typeof reference === 'string' || typeof reference === 'number') {
    let type = typeof record.__type__ === 'string' ? record.__type__ : undefined
    if (type === 'Node' || type === 'cc.Node')
      type = 'cc.Node'
    else if (type === 'Component' || type === 'cc.Component')
      type = 'cc.Component'
    else if (type && !type.startsWith('cc.'))
      type = `cc.${type}`
    return { dumpValue: { uuid: reference }, dumpType: type ?? inferNodeDumpType(record, propertyName) }
  }
  return { dumpValue: value, dumpType: inferNodeDumpType(record, propertyName) }
}

export function normalizeTransformValue(value: unknown, type: TransformType, is2D: boolean): { value: UnknownRecord, warning?: string } {
  const source = asRecord(value) ?? {}
  const result = { ...source }
  const number = (key: string): number | undefined => typeof source[key] === 'number' ? source[key] : undefined
  let warning: string | undefined
  if (is2D) {
    if (type === 'position') {
      const z = number('z')
      if (z !== undefined && Math.abs(z) > 0.001)
        warning = `2D node: z position (${z}) ignored, set to 0`
      result.z = 0
    }
    else if (type === 'rotation') {
      const x = number('x') ?? 0
      const y = number('y') ?? 0
      if (Math.abs(x) > 0.001 || Math.abs(y) > 0.001)
        warning = '2D node: x,y rotations ignored, only z rotation applied'
      result.x = 0
      result.y = 0
      result.z = number('z') ?? 0
    }
    else if (result.z === undefined) {
      result.z = 1
    }
  }
  else {
    const fallback = type === 'scale' ? 1 : 0
    result.x = number('x') ?? fallback
    result.y = number('y') ?? fallback
    result.z = number('z') ?? fallback
  }
  return { value: result, warning }
}

export function is2DNodeInfo(nodeInfo: unknown): boolean {
  const record = asRecord(nodeInfo)
  const components = Array.isArray(record?.components) ? record.components : []
  const types = components.map(component => asRecord(component)?.type).filter((type): type is string => typeof type === 'string')
  if (types.some(type => ['Sprite', 'Label', 'Button', 'Layout', 'Widget', 'Mask', 'Graphics'].some(name => type.includes(`cc.${name}`))))
    return true
  if (types.some(type => ['MeshRenderer', 'Camera', 'Light', 'DirectionalLight', 'PointLight', 'SpotLight'].some(name => type.includes(`cc.${name}`))))
    return false
  const position = asRecord(record?.position)
  return typeof position?.z === 'number' ? Math.abs(position.z) < 0.001 : false
}
