import type { PrefabReferenceContext } from './prefab-property'
import { asPrefabRecord, createColor, createSize, createVec2, getComponentPropertyValue, isSerializedScriptClassId } from './prefab-format'
import { serializeComponentProperty } from './prefab-property'

export function extractPrefabComponents(nodeData: unknown): Record<string, unknown>[] {
  const node = asPrefabRecord(nodeData)
  const value = asPrefabRecord(node?.value)
  for (const source of [node?.__comps__, node?.components, value?.__comps__, value?.components]) {
    if (Array.isArray(source)) {
      return source.map(asPrefabRecord).filter((component): component is Record<string, unknown> => component !== null && (typeof component.__type__ === 'string' || typeof component.type === 'string'))
    }
  }
  return []
}

function addGenericProperties(component: Record<string, unknown>, componentData: unknown): void {
  const source = asPrefabRecord(componentData)
  if (!source)
    return
  for (const property of ['enabled', 'color', 'string', 'fontSize', 'spriteFrame', 'type', 'sizeMode']) {
    if (Object.hasOwn(source, property)) {
      const value = getComponentPropertyValue(source, property)
      if (value !== undefined)
        component[`_${property}`] = value
    }
  }
}

export function createStandardPrefabComponent(componentData: unknown, nodeId: number, prefabInfoId: number): Record<string, unknown> | null {
  const source = asPrefabRecord(componentData)
  const componentType = typeof source?.__type__ === 'string' ? source.__type__ : typeof source?.type === 'string' ? source.type : null
  if (!componentType)
    return null
  const component: Record<string, unknown> = {
    __type__: componentType,
    _name: '',
    _objFlags: 0,
    node: { __id__: nodeId },
    _enabled: getComponentPropertyValue(source, 'enabled', true),
    __prefab: { __id__: prefabInfoId },
  }
  if (componentType === 'cc.UITransform') {
    component._contentSize = createSize(getComponentPropertyValue(source, 'contentSize', { width: 100, height: 100 }))
    component._anchorPoint = createVec2(getComponentPropertyValue(source, 'anchorPoint', { x: 0.5, y: 0.5 }))
  }
  else if (componentType === 'cc.Sprite') {
    Object.assign(component, {
      _visFlags: 0,
      _customMaterial: null,
      _srcBlendFactor: 2,
      _dstBlendFactor: 4,
      _color: createColor(getComponentPropertyValue(source, 'color', { r: 255, g: 255, b: 255, a: 255 })),
      _spriteFrame: getComponentPropertyValue(source, 'spriteFrame', null),
      _type: getComponentPropertyValue(source, 'type', 0),
      _fillType: 0,
      _sizeMode: getComponentPropertyValue(source, 'sizeMode', 1),
      _fillCenter: createVec2({ x: 0, y: 0 }),
      _fillStart: 0,
      _fillRange: 0,
      _isTrimmedMode: true,
      _useGrayscale: false,
      _atlas: null,
    })
  }
  else if (componentType === 'cc.Label') {
    Object.assign(component, {
      _visFlags: 0,
      _customMaterial: null,
      _srcBlendFactor: 2,
      _dstBlendFactor: 4,
      _color: createColor(getComponentPropertyValue(source, 'color', { r: 0, g: 0, b: 0, a: 255 })),
      _string: getComponentPropertyValue(source, 'string', 'Label'),
      _horizontalAlign: 1,
      _verticalAlign: 1,
      _actualFontSize: 20,
      _fontSize: getComponentPropertyValue(source, 'fontSize', 20),
      _fontFamily: 'Arial',
      _lineHeight: 40,
      _overflow: 1,
      _enableWrapText: false,
      _font: null,
      _isSystemFontUsed: true,
      _isItalic: false,
      _isBold: false,
      _isUnderline: false,
      _underlineHeight: 2,
      _cacheMode: 0,
    })
  }
  else if (componentType === 'cc.Button') {
    Object.assign(component, {
      clickEvents: [],
      _interactable: true,
      _transition: 2,
      _normalColor: createColor({ r: 214, g: 214, b: 214, a: 255 }),
      _hoverColor: createColor({ r: 211, g: 211, b: 211, a: 255 }),
      _pressedColor: createColor({ r: 255, g: 255, b: 255, a: 255 }),
      _disabledColor: createColor({ r: 124, g: 124, b: 124, a: 255 }),
      _duration: 0.1,
      _zoomScale: 1.2,
    })
  }
  else {
    addGenericProperties(component, source)
  }
  component._id = ''
  return component
}

function dumpedProperty(properties: Record<string, unknown> | null, name: string, fallback: unknown): unknown {
  const property = asPrefabRecord(properties?.[name])
  return property?.value ?? fallback
}

export function getPrefabComponentType(componentData: unknown): string {
  const source = asPrefabRecord(componentData)
  const cid = typeof source?.cid === 'string' && source.cid.length > 0 ? source.cid : null
  const dumpType = typeof source?.__type__ === 'string' ? source.__type__ : null
  const displayType = typeof source?.type === 'string' ? source.type : null
  const value = asPrefabRecord(source?.value)
  const valueCid = typeof value?.cid === 'string' && value.cid.length > 0 ? value.cid : null
  const valueType = typeof value?.__type__ === 'string' ? value.__type__ : null

  if (cid ?? valueCid)
    return cid ?? valueCid ?? 'cc.Component'
  const scriptClassId = [dumpType, valueType, displayType].find(type => type && isSerializedScriptClassId(type))
  if (scriptClassId)
    return scriptClassId
  const serializedType = [dumpType, valueType].find(type => type && !['cc.Script', 'cc.Component'].includes(type))
  return serializedType ?? displayType ?? dumpType ?? valueType ?? 'cc.Component'
}

export function createPrefabComponent(componentData: unknown, nodeIndex: number, context?: PrefabReferenceContext): Record<string, unknown> {
  const source = asPrefabRecord(componentData) ?? {}
  const componentType = getPrefabComponentType(source)
  const properties = asPrefabRecord(source.properties)
  const component: Record<string, unknown> = {
    __type__: componentType,
    _name: '',
    _objFlags: 0,
    __editorExtras__: {},
    node: { __id__: nodeIndex },
    _enabled: typeof source.enabled === 'boolean' ? source.enabled : true,
    __prefab: null,
  }
  if (componentType === 'cc.UITransform') {
    component._contentSize = createSize(dumpedProperty(properties, 'contentSize', { width: 100, height: 100 }))
    component._anchorPoint = createVec2(dumpedProperty(properties, 'anchorPoint', { x: 0.5, y: 0.5 }))
  }
  else if (componentType === 'cc.Sprite') {
    const spriteFrame = properties?._spriteFrame ?? properties?.spriteFrame
    Object.assign(component, {
      _spriteFrame: spriteFrame ? serializeComponentProperty(spriteFrame, context) : null,
      _type: dumpedProperty(properties, '_type', 0),
      _fillType: dumpedProperty(properties, '_fillType', 0),
      _sizeMode: dumpedProperty(properties, '_sizeMode', 1),
      _fillCenter: createVec2({ x: 0, y: 0 }),
      _fillStart: dumpedProperty(properties, '_fillStart', 0),
      _fillRange: dumpedProperty(properties, '_fillRange', 0),
      _isTrimmedMode: dumpedProperty(properties, '_isTrimmedMode', true),
      _useGrayscale: dumpedProperty(properties, '_useGrayscale', false),
      _atlas: null,
    })
  }
  else if (componentType === 'cc.Button') {
    const target = properties?._target ?? properties?.target
    Object.assign(component, {
      _interactable: true,
      _transition: 3,
      _normalColor: createColor({ r: 255, g: 255, b: 255, a: 255 }),
      _hoverColor: createColor({ r: 211, g: 211, b: 211, a: 255 }),
      _pressedColor: createColor({ r: 255, g: 255, b: 255, a: 255 }),
      _disabledColor: createColor({ r: 124, g: 124, b: 124, a: 255 }),
      _normalSprite: null,
      _hoverSprite: null,
      _pressedSprite: null,
      _disabledSprite: null,
      _duration: 0.1,
      _zoomScale: 1.2,
      _target: target ? serializeComponentProperty(target, context) : { __id__: nodeIndex },
      _clickEvents: [],
    })
  }
  else if (componentType === 'cc.Label') {
    Object.assign(component, {
      _string: dumpedProperty(properties, '_string', 'Label'),
      _horizontalAlign: 1,
      _verticalAlign: 1,
      _actualFontSize: 20,
      _fontSize: 20,
      _fontFamily: 'Arial',
      _lineHeight: 25,
      _overflow: 0,
      _enableWrapText: true,
      _font: null,
      _isSystemFontUsed: true,
      _spacingX: 0,
      _isItalic: false,
      _isBold: false,
      _isUnderline: false,
      _underlineHeight: 2,
      _cacheMode: 0,
    })
  }
  else if (properties) {
    const excluded = new Set(['node', 'enabled', '__type__', 'uuid', 'name', '__scriptAsset', '_objFlags'])
    for (const [key, value] of Object.entries(properties)) {
      if (!excluded.has(key)) {
        const serialized = serializeComponentProperty(value, context)
        if (serialized !== undefined)
          component[key] = serialized
      }
    }
  }
  const id = typeof component._id === 'string' ? component._id : ''
  delete component._id
  component._id = id
  return component
}
