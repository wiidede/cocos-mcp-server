import { describe, expect, it } from 'vitest'
import { componentMatchesType, describeComponent, extractComponentProperties, findComponentByType, findComponentIndexByType, getComponentCandidates, getComponentSceneId, getComponentType, summarizeComponent } from './component-query'

describe('component query helpers', () => {
  it('uses the Cocos type fields in priority order', () => {
    expect(getComponentType({ __type__: 'cc.Sprite', cid: 'cc.Label' })).toBe('cc.Sprite')
    expect(getComponentType({ cid: 'cc.Label' })).toBe('cc.Label')
  })

  it('finds components by exact and shortened built-in type', () => {
    const components = [{ cid: 'Sprite' }, { type: 'PlayerController' }]
    expect(findComponentByType(components, 'cc.Sprite')).toEqual({ cid: 'Sprite' })
    expect(findComponentByType(components, 'PlayerController')).toEqual({ type: 'PlayerController' })
  })

  it('extracts and summarizes component values', () => {
    const component = { type: 'Player', uuid: { value: 'component-1' }, enabled: false, value: { name: 'Player', speed: 10 } }
    expect(extractComponentProperties(component)).toEqual({ name: 'Player', speed: 10 })
    expect(summarizeComponent(component, true)).toMatchObject({
      type: 'Player',
      uuid: 'component-1',
      enabled: false,
      properties: { speed: 10 },
    })
  })
})

describe('component identity helpers', () => {
  const component = {
    __type__: 'cc.Script',
    type: 'Player',
    cid: 'player-cid',
    value: { __type__: 'Player', name: 'Player', uuid: { value: 'component-id' } },
  }

  it('collects type candidates and matches cc prefix differences', () => {
    expect(getComponentCandidates(component)).toEqual(['cc.Script', 'Player', 'player-cid', 'Player', 'Player'])
    expect(componentMatchesType({ __type__: 'cc.Sprite' }, 'Sprite')).toBe(true)
    expect(componentMatchesType(component, 'Player')).toBe(true)
  })

  it('finds indexes and extracts scene ids', () => {
    expect(findComponentIndexByType([{ type: 'cc.Label' }, component], 'Player')).toBe(1)
    expect(getComponentSceneId(component)).toBe('component-id')
    expect(getComponentSceneId({ uuid: 'direct-id' })).toBe('direct-id')
    expect(describeComponent(component)).toBe('cc.Script(id:component-id)')
  })
})
