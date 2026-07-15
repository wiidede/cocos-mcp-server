type EventArguments = Record<string, unknown>

export function buildButtonClickEvent(args: EventArguments): Record<string, unknown> {
  return {
    __type__: 'cc.ClickEvent',
    target: typeof args.targetNodeUuid === 'string' ? { uuid: args.targetNodeUuid } : null,
    component: typeof args.component === 'string' ? args.component : '',
    handler: typeof args.handler === 'string' ? args.handler : '',
    customEventData: typeof args.customEventData === 'string' ? args.customEventData : '',
  }
}

export function getButtonEventFieldName(component: Record<string, unknown>): '_clickEvents' | 'clickEvents' {
  return Object.hasOwn(component, '_clickEvents') ? '_clickEvents' : 'clickEvents'
}

export function getButtonEvents(component: Record<string, unknown>, fieldName: string): unknown[] {
  return Array.isArray(component[fieldName]) ? component[fieldName] : []
}
