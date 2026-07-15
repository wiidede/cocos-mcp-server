import { describe, expect, it } from 'vitest'
import { buildButtonClickEvent, getButtonEventFieldName, getButtonEvents } from './component-event'

describe('component event helpers', () => {
  it('builds Cocos click event dumps from validated fields', () => {
    expect(buildButtonClickEvent({ targetNodeUuid: 'node', component: 'Menu', handler: 'open' })).toEqual({ __type__: 'cc.ClickEvent', target: { uuid: 'node' }, component: 'Menu', handler: 'open', customEventData: '' })
  })

  it('supports old and new click event field names', () => {
    expect(getButtonEventFieldName({ _clickEvents: [] })).toBe('_clickEvents')
    expect(getButtonEventFieldName({ clickEvents: [1] })).toBe('clickEvents')
    expect(getButtonEvents({ clickEvents: [1] }, 'clickEvents')).toEqual([1])
  })
})
