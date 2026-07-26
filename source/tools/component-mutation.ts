import type { ToolResponse } from '../types'

interface NodePropertyInput {
  nodeUuid: string
  componentType: string
  property: string
  value: unknown
}

export interface ComponentPropertyVerification {
  verified: boolean
  actualValue: unknown
  fullData: unknown
}

const nodeProperties = new Set(['name', 'active', 'layer', 'mobility', 'parent', 'children', 'hideFlags'])
const nodeTransformProperties = new Set(['position', 'rotation', 'scale', 'eulerAngles', 'angle'])

export function getNodePropertyRedirect(input: NodePropertyInput): ToolResponse | null {
  const { nodeUuid, componentType, property, value } = input
  const isTransform = nodeTransformProperties.has(property)
  const isNodeProperty = nodeProperties.has(property) || isTransform
  if (!isNodeProperty)
    return null

  const method = isTransform ? 'set_node_transform' : 'set_node_property'
  const argument = isTransform ? property : `property="${property}"`
  const instruction = `Property '${property}' should be set using ${method} method, not set_component_property. Please use: ${method}(uuid="${nodeUuid}", ${argument}=${JSON.stringify(value)})`
  if (componentType === 'cc.Node' || componentType === 'Node') {
    return {
      success: false,
      error: `Property '${property}' is a node ${isTransform ? 'transform' : 'basic'} property, not a component property`,
      instruction,
    }
  }
  return {
    success: false,
    error: `Property '${property}' is a node property, not a component property`,
    instruction,
  }
}

export function unwrapComponentReference(value: unknown): string {
  if (typeof value === 'string')
    return value
  if (typeof value !== 'object' || value === null)
    return ''
  const record = value as Record<string, unknown>
  if ('value' in record)
    return unwrapComponentReference(record.value)
  if ('uuid' in record)
    return unwrapComponentReference(record.uuid)
  if ('__uuid__' in record)
    return unwrapComponentReference(record.__uuid__)
  if ('__id__' in record)
    return `__id__:${String(record.__id__)}`
  return ''
}

export function isComponentReference(value: unknown): boolean {
  return unwrapComponentReference(value) !== ''
}

export function unwrapPropertyDumpValue(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || !('value' in value))
    return value
  return (value as Record<string, unknown>).value
}

export function verifyComponentPropertyValue(actualValue: unknown, expectedValue: unknown, originalValue: unknown, strictReference: boolean = false): boolean {
  if (Array.isArray(expectedValue) && Array.isArray(actualValue)) {
    if (actualValue.length !== expectedValue.length)
      return false
    const expectedReferences = expectedValue.map(unwrapComponentReference)
    const actualReferences = actualValue.map(unwrapComponentReference)
    if (expectedReferences.every(reference => reference !== ''))
      return actualReferences.every((reference, index) => reference === expectedReferences[index])
    return JSON.stringify(actualValue) === JSON.stringify(expectedValue)
  }

  const expectedRecord = typeof expectedValue === 'object' && expectedValue !== null
    ? expectedValue as Record<string, unknown>
    : null

  if (expectedRecord && 'uuid' in expectedRecord) {
    const actualReference = unwrapComponentReference(actualValue)
    const expectedReference = unwrapComponentReference(expectedValue)
    if (actualReference === expectedReference && expectedReference !== '')
      return true
    if (strictReference)
      return false
    return isComponentReference(actualValue) && JSON.stringify(actualValue) !== JSON.stringify(originalValue)
  }

  if (typeof actualValue === typeof expectedValue) {
    if (typeof actualValue === 'object' && actualValue !== null && expectedValue !== null)
      return JSON.stringify(actualValue) === JSON.stringify(expectedValue)
    return actualValue === expectedValue
  }

  return String(actualValue) === String(expectedValue)
    || Number(actualValue) === Number(expectedValue)
}
