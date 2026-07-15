type ComponentRecord = Record<string, unknown>

function asRecord(value: unknown): ComponentRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as ComponentRecord : null
}

export function getComponentType(component: unknown): string | null {
  const record = asRecord(component)
  if (!record)
    return null
  for (const key of ['__type__', 'cid', 'type']) {
    if (typeof record[key] === 'string' && record[key])
      return record[key] as string
  }
  return null
}

export function findComponentByType(components: unknown[], componentType: string): ComponentRecord | null {
  for (const component of components) {
    const record = asRecord(component)
    if (!record)
      continue
    const type = getComponentType(record)
    if (type === componentType)
      return record
    if (componentType.startsWith('cc.') && record.cid === componentType.replace(/^cc\./, ''))
      return record
  }
  return null
}

export function getComponentCandidates(component: unknown): string[] {
  const record = asRecord(component)
  if (!record)
    return []
  const value = asRecord(record.value)
  return [record.__type__, record.type, record.cid, value?.__type__, value?.name, record.name]
    .filter((candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0)
}

export function componentMatchesType(component: unknown, componentType: string): boolean {
  const target = componentType.replace(/^cc\./, '')
  return getComponentCandidates(component).some(candidate => candidate.replace(/^cc\./, '') === target)
}

export function findComponentIndexByType(components: unknown[], componentType: string): number {
  return components.findIndex(component => componentMatchesType(component, componentType))
}

export function getComponentSceneId(component: unknown): string | null {
  const record = asRecord(component)
  if (!record)
    return null
  const value = asRecord(record.value)
  const valueUuid = asRecord(value?.uuid)?.value ?? value?.uuid
  const uuid = asRecord(record.uuid)?.value ?? record.uuid
  return typeof valueUuid === 'string' ? valueUuid : typeof uuid === 'string' ? uuid : null
}

export function describeComponent(component: unknown): string {
  return `${getComponentType(component) ?? 'Unknown'}(id:${getComponentSceneId(component) ?? 'unknown'})`
}

export function extractComponentProperties(component: unknown): ComponentRecord {
  const record = asRecord(component)
  if (!record)
    return {}
  const value = asRecord(record.value)
  if (value)
    return value
  const properties: ComponentRecord = {}
  const excluded = new Set(['__type__', 'enabled', 'node', '_id', '__scriptAsset', 'uuid', 'name', '_name', '_objFlags', '_enabled', 'type', 'readonly', 'visible', 'cid', 'editor', 'extends'])
  for (const [key, value] of Object.entries(record)) {
    if (!excluded.has(key) && !key.startsWith('_'))
      properties[key] = value
  }
  return properties
}

export function summarizeComponent(component: unknown, includeProperties: boolean): ComponentRecord {
  const record = asRecord(component) ?? {}
  const value = asRecord(record.value)
  const uuidValue = asRecord(record.uuid)?.value ?? record.uuid ?? null
  const result: ComponentRecord = {
    type: getComponentType(record) ?? 'Unknown',
    name: value?.name ?? record.type ?? record.cid ?? '',
    uuid: typeof uuidValue === 'string' ? uuidValue : null,
    enabled: typeof record.enabled === 'boolean' ? record.enabled : true,
  }
  if (includeProperties)
    result.properties = extractComponentProperties(record)
  return result
}
