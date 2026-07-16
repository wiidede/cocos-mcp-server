import type { ToolDefinition, ToolExecutor, ToolResponse } from '../types'
import type { ComponentPropertyVerification } from './component-mutation'
import { requestAssetDb, requestScene } from '../editor-message'
import { getNodePropertyRedirect, unwrapPropertyDumpValue, verifyComponentPropertyValue } from './component-mutation'
import { analyzeComponentProperty, buildUnsupportedComponentPropertyTypeError, inferComponentPropertyType, isScriptComponent, normalizeComponentPropertyType, parseComponentColor, processComponentTypedValue, resolveCanonicalAssetReference, resolveComponentAssetType, resolveComponentPropertyPath } from './component-property'
import { componentMatchesType, describeComponent, extractComponentProperties, findComponentByType, findComponentIndexByType, getComponentSceneId, getComponentType, summarizeComponent } from './component-query'
import { toolFailure } from './tool-response'

type ToolArguments = Record<string, unknown>

interface ComponentPropertyInput extends ToolArguments {
  nodeUuid: string
  componentType: string
  property: string
  value: unknown
  propertyType?: string
}

function isToolArguments(value: unknown): value is ToolArguments {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export class ComponentTools implements ToolExecutor {
  getTools(): ToolDefinition[] {
    return [
      {
        name: 'add_component',
        description: 'Add a component to a specific node. IMPORTANT: You must provide the nodeUuid parameter to specify which node to add the component to.',
        inputSchema: {
          type: 'object',
          properties: {
            nodeUuid: {
              type: 'string',
              description: 'Target node UUID. REQUIRED: You must specify the exact node to add the component to. Use get_all_nodes or find_node_by_name to get the UUID of the desired node.',
            },
            componentType: {
              type: 'string',
              description: 'Component type (e.g., cc.Sprite, cc.Label, cc.Button)',
            },
          },
          required: ['nodeUuid', 'componentType'],
        },
      },
      {
        name: 'remove_component',
        description: 'Remove a component from a node. Use the component instance uuid returned by get_components when available; type and cid are also accepted.',
        inputSchema: {
          type: 'object',
          properties: {
            nodeUuid: {
              type: 'string',
              description: 'Node UUID',
            },
            componentType: {
              type: 'string',
              description: 'Component instance uuid, type, or cid returned by get_components. The instance uuid is required when removing cc.MissingScript without a cid.',
            },
          },
          required: ['nodeUuid', 'componentType'],
        },
      },
      {
        name: 'get_components',
        description: 'Get all components of a node. By default only returns summary info (type, name, uuid, enabled). Pass includeProperties=true to also include the full property tree (much larger payload).',
        inputSchema: {
          type: 'object',
          properties: {
            nodeUuid: {
              type: 'string',
              description: 'Node UUID',
            },
            includeProperties: {
              type: 'boolean',
              description: 'Include full component properties (default false to keep payload small)',
              default: false,
            },
          },
          required: ['nodeUuid'],
        },
      },
      {
        name: 'get_component_info',
        description: 'Get specific component information',
        inputSchema: {
          type: 'object',
          properties: {
            nodeUuid: {
              type: 'string',
              description: 'Node UUID',
            },
            componentType: {
              type: 'string',
              description: 'Component type to get info for',
            },
          },
          required: ['nodeUuid', 'componentType'],
        },
      },
      {
        name: 'set_component_property',
        description: 'Set component property values for UI components or custom script components. Supports setting properties of built-in UI components (e.g., cc.Label, cc.Sprite) and custom script components. Note: For node basic properties (name, active, layer, etc.), use set_node_property. For node transform properties (position, rotation, scale, etc.), use set_node_transform.',
        inputSchema: {
          type: 'object',
          properties: {
            nodeUuid: {
              type: 'string',
              description: 'Target node UUID - Must specify the node to operate on',
            },
            componentType: {
              type: 'string',
              description: 'Component type - Can be built-in components (e.g., cc.Label) or custom script components (e.g., MyScript). If unsure about component type, use get_components first to retrieve all components on the node.',
              // 移除enum限制，允许任意组件类型包括自定义脚本
            },
            property: {
              type: 'string',
              description: 'Property name - The property to set. Common properties include:\n'
                + '• cc.Label: string (text content), fontSize (font size), color (text color)\n'
                + '• cc.Sprite: spriteFrame (sprite frame), color (tint color), sizeMode (size mode)\n'
                + '• cc.Button: normalColor (normal color), pressedColor (pressed color), target (target node)\n'
                + '• cc.UITransform: contentSize (content size), anchorPoint (anchor point)\n'
                + '• Custom Scripts: Based on properties defined in the script',
            },
            propertyType: {
              type: 'string',
              description: 'Property type - Must explicitly specify the property data type for correct value conversion and validation',
              enum: [
                'string',
                'number',
                'boolean',
                'integer',
                'float',
                'color',
                'vec2',
                'vec3',
                'size',
                'node',
                'component',
                'spriteFrame',
                'prefab',
                'asset',
                'nodeArray',
                'colorArray',
                'numberArray',
                'stringArray',
              ],
            },

            value: {
              description: 'Property value - Use the corresponding data format based on propertyType:\n\n'
                + '📝 Basic Data Types:\n'
                + '• string: "Hello World" (text string)\n'
                + '• number/integer/float: 42 or 3.14 (numeric value)\n'
                + '• boolean: true or false (boolean value)\n\n'
                + '🎨 Color Type:\n'
                + '• color: {"r":255,"g":0,"b":0,"a":255} (RGBA values, range 0-255)\n'
                + '  - Alternative: "#FF0000" (hexadecimal format)\n'
                + '  - Transparency: a value controls opacity, 255 = fully opaque, 0 = fully transparent\n\n'
                + '📐 Vector and Size Types:\n'
                + '• vec2: {"x":100,"y":50} (2D vector)\n'
                + '• vec3: {"x":1,"y":2,"z":3} (3D vector)\n'
                + '• size: {"width":100,"height":50} (size dimensions)\n\n'
                + '🔗 Reference Types (using UUID strings):\n'
                + '• node: "target-node-uuid" (node reference)\n'
                + '  How to get: Use get_all_nodes or find_node_by_name to get node UUIDs\n'
                + '• component: "component-uuid" OR "node-uuid" (component reference, e.g. @property(MyComponent))\n'
                + '  Preferred: pass the target component\'s own uuid (the "uuid" field returned by get_components / node_query get_info)\n'
                + '  Also accepted: pass the NODE uuid that holds the component — the system finds the component by its declared type\n'
                + '  Note: the property\'s declared type is authoritative; you may omit propertyType and it will be auto-detected as a component reference\n'
                + '• spriteFrame: "spriteframe-uuid" (sprite frame asset)\n'
                + '  How to get: Check asset database or use asset browser\n'
                + '• prefab: "prefab-uuid" (prefab asset)\n'
                + '  How to get: Check asset database or use asset browser\n'
                + '• asset: "asset-uuid" (generic asset reference)\n'
                + '  How to get: Check asset database or use asset browser\n\n'
                + '📋 Array Types:\n'
                + '• nodeArray: ["uuid1","uuid2"] (array of node UUIDs)\n'
                + '• colorArray: [{"r":255,"g":0,"b":0,"a":255}] (array of colors)\n'
                + '• numberArray: [1,2,3,4,5] (array of numbers)\n'
                + '• stringArray: ["item1","item2"] (array of strings)',
            },
          },
          required: ['nodeUuid', 'componentType', 'property', 'propertyType', 'value'],
        },
      },
      {
        name: 'attach_script',
        description: 'Attach a script component to a node',
        inputSchema: {
          type: 'object',
          properties: {
            nodeUuid: {
              type: 'string',
              description: 'Node UUID',
            },
            scriptPath: {
              type: 'string',
              description: 'Script asset path (e.g., db://assets/scripts/MyScript.ts)',
            },
          },
          required: ['nodeUuid', 'scriptPath'],
        },
      },
      {
        name: 'get_available_components',
        description: 'Get list of available component types',
        inputSchema: {
          type: 'object',
          properties: {
            category: {
              type: 'string',
              description: 'Component category filter',
              enum: ['all', 'renderer', 'ui', 'physics', 'animation', 'audio'],
              default: 'all',
            },
          },
        },
      },
    ]
  }

  async execute(toolName: string, args: unknown): Promise<ToolResponse> {
    if (!isToolArguments(args)) {
      return toolFailure('Tool arguments must be a JSON object')
    }

    switch (toolName) {
      case 'add_component':
        return typeof args.nodeUuid === 'string' && typeof args.componentType === 'string'
          ? this.addComponent(args.nodeUuid, args.componentType)
          : toolFailure('add_component requires nodeUuid and componentType')
      case 'remove_component':
        return typeof args.nodeUuid === 'string' && typeof args.componentType === 'string'
          ? this.removeComponent(args.nodeUuid, args.componentType)
          : toolFailure('remove_component requires nodeUuid and componentType')
      case 'get_components':
        return typeof args.nodeUuid === 'string' && (args.includeProperties === undefined || typeof args.includeProperties === 'boolean')
          ? this.getComponents(args.nodeUuid, args.includeProperties === true)
          : toolFailure('get_components requires nodeUuid and optional includeProperties')
      case 'get_component_info':
        return typeof args.nodeUuid === 'string' && typeof args.componentType === 'string'
          ? this.getComponentInfo(args.nodeUuid, args.componentType)
          : toolFailure('get_component_info requires nodeUuid and componentType')
      case 'set_component_property':
        return typeof args.nodeUuid === 'string'
          && typeof args.componentType === 'string'
          && typeof args.property === 'string'
          && Object.hasOwn(args, 'value')
          ? this.setComponentProperty({
              ...args,
              nodeUuid: args.nodeUuid,
              componentType: args.componentType,
              property: args.property,
              value: args.value,
              propertyType: typeof args.propertyType === 'string' ? args.propertyType : undefined,
            })
          : toolFailure('set_component_property requires nodeUuid, componentType, property, and value')
      case 'attach_script':
        return typeof args.nodeUuid === 'string' && typeof args.scriptPath === 'string'
          ? this.attachScript(args.nodeUuid, args.scriptPath)
          : toolFailure('attach_script requires nodeUuid and scriptPath')
      case 'get_available_components':
        return args.category === undefined || typeof args.category === 'string'
          ? this.getAvailableComponents(args.category)
          : toolFailure('get_available_components category must be a string when provided')
      default:
        throw new Error(`Unknown tool: ${toolName}`)
    }
  }

  /**
   * 把脚本资产 UUID 解析为对应的类名（仅对脚本资产有效）。
   * Cocos Creator 的 create-component 接受类名或 { uuid, extends } 对象；
   * 传纯 UUID 字符串时部分版本会失败，这里做一次显式转换。
   */
  private async resolveScriptClassNameByUuid(uuid: string): Promise<string | null> {
    try {
      // 1) 直接通过 asset-db 查资产信息
      const assetInfo = await requestAssetDb('query-asset-info', uuid)
      if (assetInfo && assetInfo.type === 'script' && assetInfo.name) {
        return assetInfo.name
      }
      const nestedAsset = assetInfo && isToolArguments(assetInfo.asset) ? assetInfo.asset : null
      if (nestedAsset && typeof nestedAsset.name === 'string') {
        return nestedAsset.name
      }
    }
    catch {
      // ignore
    }
    return null
  }

  private async addComponent(nodeUuid: string, componentType: string): Promise<ToolResponse> {
    return new Promise(async (resolve) => {
      // 判断是否为脚本组件（不以 cc. 开头或明显是脚本资产 UUID）
      const isScriptComponent = !componentType.startsWith('cc.')
      const looksLikeUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(componentType)

      // 1) 如果传的是脚本资产 UUID，先解析为类名（create-component 兼容性更好）
      let effectiveComponentType = componentType
      if (looksLikeUuid) {
        const resolvedName = await this.resolveScriptClassNameByUuid(componentType)
        if (resolvedName) {
          effectiveComponentType = resolvedName
        }
      }

      // 先查找节点上是否已存在该组件
      const allComponentsInfo = await this.getComponents(nodeUuid)

      if (allComponentsInfo.success && allComponentsInfo.data?.components) {
        const existingComponent = allComponentsInfo.data.components.find((comp: unknown) => componentMatchesType(comp, effectiveComponentType))
        if (existingComponent) {
          resolve({
            success: true,
            message: `Component '${effectiveComponentType}' already exists on node`,
            data: {
              nodeUuid,
              componentType: effectiveComponentType,
              originalInput: componentType,
              componentVerified: true,
              existing: true,
              actualType: existingComponent.type,
              actualName: existingComponent.name,
            },
          })
          return
        }
      }

      // 尝试直接使用 Editor API 添加组件
      Editor.Message.request('scene', 'create-component', {
        uuid: nodeUuid,
        component: effectiveComponentType,
      }).then(async () => {
        // 等待并重试验证组件添加，因为编辑器组件同步可能需要时间
        let addedComponent: Record<string, unknown> | null = null
        let allComponentsInfo2: ToolResponse | null = null
        const maxRetries = 3

        for (let attempt = 0; attempt < maxRetries; attempt++) {
          // 第一次尝试等待 200ms，后续尝试增加等待时间
          const waitTime = 200 + (attempt * 200)
          await new Promise(resolve => setTimeout(resolve, waitTime))

          // 重新查询节点信息验证组件是否真的添加成功
          try {
            allComponentsInfo2 = await this.getComponents(nodeUuid)

            if (allComponentsInfo2.success && allComponentsInfo2.data?.components) {
              addedComponent = allComponentsInfo2.data.components.find((comp: unknown) => componentMatchesType(comp, effectiveComponentType))

              if (addedComponent) {
                // 找到组件，验证成功
                break
              }
            }
          }
          catch (verifyError: unknown) {
            // 如果是最后一次尝试，抛出错误
            if (attempt === maxRetries - 1) {
              resolve({
                success: false,
                error: `Failed to verify component addition after ${maxRetries} attempts: ${verifyError instanceof Error ? verifyError.message : String(verifyError)}`,
              })
              return
            }
            // 否则继续重试
          }
        }

        // 验证结果
        if (addedComponent) {
          resolve({
            success: true,
            message: `Component '${effectiveComponentType}' added successfully`,
            data: {
              nodeUuid,
              componentType: effectiveComponentType,
              originalInput: componentType,
              componentVerified: true,
              existing: false,
              actualType: addedComponent.type,
              actualName: addedComponent.name,
            },
          })
        }
        else if (allComponentsInfo2?.success && allComponentsInfo2.data?.components) {
          const componentList = allComponentsInfo2.data.components.map((component: unknown) =>
            `type:${getComponentType(component) ?? 'Unknown'}`,
          ).join('; ')
          resolve({
            success: false,
            error: `Component '${effectiveComponentType}' was not found on node after addition (tried ${maxRetries} times). Available components: ${componentList}`,
          })
        }
        else {
          resolve({
            success: false,
            error: `Failed to verify component addition after ${maxRetries} attempts: ${allComponentsInfo2?.error || 'Unable to get node components'}`,
          })
        }
      }).catch((err: Error) => {
        // 备用方案：使用场景脚本
        const options = {
          name: 'cocos-mcp-server',
          method: 'addComponentToNode',
          args: [nodeUuid, effectiveComponentType],
        }
        Editor.Message.request('scene', 'execute-scene-script', options).then((result: unknown) => {
          resolve(isToolArguments(result) && typeof result.success === 'boolean' ? result as unknown as ToolResponse : toolFailure('Scene script returned an invalid response'))
        }).catch((err2: Error) => {
          resolve({ success: false, error: `Direct API failed: ${err.message}, Scene script failed: ${err2.message}` })
        })
      })
    })
  }

  private async removeComponent(nodeUuid: string, componentType: string): Promise<ToolResponse> {
    return new Promise(async (resolve) => {
      // 1. 查找节点上的所有组件
      const allComponentsInfo = await this.getComponents(nodeUuid)
      if (!allComponentsInfo.success || !allComponentsInfo.data?.components) {
        resolve({ success: false, error: `Failed to get components for node '${nodeUuid}': ${allComponentsInfo.error}` })
        return
      }
      const component = allComponentsInfo.data.components.find((candidate: unknown) =>
        getComponentSceneId(candidate) === componentType || componentMatchesType(candidate, componentType),
      )
      if (!component) {
        resolve({ success: false, error: `Component '${componentType}' not found on node '${nodeUuid}'. Use component_query.get_components and pass its uuid, type, or cid.` })
        return
      }
      const componentUuid = getComponentSceneId(component)
      const removalIdentity = componentUuid ?? getComponentType(component)
      if (!removalIdentity) {
        resolve({ success: false, error: `Component '${componentType}' has no removable uuid or type identity.` })
        return
      }
      try {
        await Editor.Message.request('scene', 'remove-component', {
          uuid: nodeUuid,
          component: removalIdentity,
        })
        const afterRemoveInfo = await this.getComponents(nodeUuid)
        const stillExists = afterRemoveInfo.success && afterRemoveInfo.data?.components?.some((candidate: unknown) =>
          componentUuid
            ? getComponentSceneId(candidate) === componentUuid
            : componentMatchesType(candidate, componentType),
        )
        if (stillExists) {
          resolve({ success: false, error: `Component '${componentType}' was not removed from node '${nodeUuid}'.` })
        }
        else {
          resolve({
            success: true,
            message: `Component '${componentType}' removed successfully from node '${nodeUuid}'`,
            data: { nodeUuid, componentType: getComponentType(component), componentUuid },
          })
        }
      }
      catch (err: unknown) {
        resolve({ success: false, error: `Failed to remove component: ${err instanceof Error ? err.message : String(err)}` })
      }
    })
  }

  private async getComponents(nodeUuid: string, includeProperties: boolean = false): Promise<ToolResponse> {
    return new Promise((resolve) => {
      // 优先尝试直接使用 Editor API 查询节点信息
      requestScene('query-node', nodeUuid).then((nodeData) => {
        if (nodeData && nodeData.__comps__) {
          const components = nodeData.__comps__.map((comp) => {
            // 提取组件名称：
            // - 对于脚本组件，comp.type 就是脚本名称（如 'GameManager'）
            // - 对于内置组件，comp.cid 是类型（如 'cc.UITransform'）
            // - 也可以从 comp.value?.name 读取
            return summarizeComponent(comp, includeProperties)
          })

          resolve({
            success: true,
            data: {
              nodeUuid,
              count: components.length,
              components,
            },
          })
        }
        else {
          resolve({ success: false, error: 'Node not found or no components data' })
        }
      }).catch((err: Error) => {
        // 备用方案：使用场景脚本
        const options = {
          name: 'cocos-mcp-server',
          method: 'getNodeInfo',
          args: [nodeUuid],
        }

        Editor.Message.request('scene', 'execute-scene-script', options).then((result: unknown) => {
          if (isToolArguments(result) && result.success === true && isToolArguments(result.data)) {
            resolve({
              success: true,
              data: result.data.components,
            })
          }
          else {
            resolve(isToolArguments(result) && typeof result.success === 'boolean' ? result as unknown as ToolResponse : toolFailure('Scene script returned an invalid response'))
          }
        }).catch((err2: Error) => {
          resolve({ success: false, error: `Direct API failed: ${err.message}, Scene script failed: ${err2.message}` })
        })
      })
    })
  }

  private async getComponentInfo(nodeUuid: string, componentType: string): Promise<ToolResponse> {
    return new Promise((resolve) => {
      // 优先尝试直接使用 Editor API 查询节点信息
      requestScene('query-node', nodeUuid).then((nodeData) => {
        if (nodeData && nodeData.__comps__) {
          const component = findComponentByType(nodeData.__comps__, componentType)

          if (component) {
            resolve({
              success: true,
              data: {
                nodeUuid,
                componentType,
                enabled: component.enabled !== undefined ? component.enabled : true,
                properties: extractComponentProperties(component),
              },
            })
          }
          else {
            resolve({ success: false, error: `Component '${componentType}' not found on node` })
          }
        }
        else {
          resolve({ success: false, error: 'Node not found or no components data' })
        }
      }).catch((err: Error) => {
        // 备用方案：使用场景脚本
        const options = {
          name: 'cocos-mcp-server',
          method: 'getNodeInfo',
          args: [nodeUuid],
        }

        Editor.Message.request('scene', 'execute-scene-script', options).then((result: unknown) => {
          const data = isToolArguments(result) && isToolArguments(result.data) ? result.data : null
          if (isToolArguments(result) && result.success === true && data && Array.isArray(data.components)) {
            const component = data.components.find(comp => componentMatchesType(comp, componentType))
            if (component) {
              resolve({
                success: true,
                data: {
                  nodeUuid,
                  componentType,
                  ...component,
                },
              })
            }
            else {
              resolve({ success: false, error: `Component '${componentType}' not found on node` })
            }
          }
          else {
            resolve({ success: false, error: isToolArguments(result) && typeof result.error === 'string' ? result.error : 'Failed to get component info' })
          }
        }).catch((err2: Error) => {
          resolve({ success: false, error: `Direct API failed: ${err.message}, Scene script failed: ${err2.message}` })
        })
      })
    })
  }

  private async findComponentTypeByUuid(componentUuid: string): Promise<string | null> {
    console.log(`[findComponentTypeByUuid] Searching for component type with UUID: ${componentUuid}`)
    if (!componentUuid) {
      return null
    }
    try {
      const nodeTree = await requestScene('query-node-tree')
      if (!nodeTree) {
        console.warn('[findComponentTypeByUuid] Failed to query node tree.')
        return null
      }

      const queue = [nodeTree]

      while (queue.length > 0) {
        const currentNodeInfo = queue.shift()
        if (!currentNodeInfo || !currentNodeInfo.uuid) {
          continue
        }

        try {
          const fullNodeData = await requestScene('query-node', currentNodeInfo.uuid)
          if (fullNodeData.__comps__) {
            for (const comp of fullNodeData.__comps__) {
              if (typeof comp.uuid === 'object' && comp.uuid?.value === componentUuid) {
                const componentType = getComponentType(comp)
                console.log(`[findComponentTypeByUuid] Found component type '${componentType}' for UUID ${componentUuid} on node ${fullNodeData.name?.value}`)
                return componentType
              }
            }
          }
        }
        catch (e) {
          console.warn(`[findComponentTypeByUuid] Could not query node ${currentNodeInfo.uuid}:`, e)
        }

        if (currentNodeInfo.children) {
          for (const child of currentNodeInfo.children) {
            queue.push(child)
          }
        }
      }

      console.warn(`[findComponentTypeByUuid] Component with UUID ${componentUuid} not found in scene tree.`)
      return null
    }
    catch (error) {
      console.error(`[findComponentTypeByUuid] Error while searching for component type:`, error)
      return null
    }
  }

  /**
   * 通过 query-node 拿指定 componentType 的完整组件对象（含 value 字段）。
   * 避免依赖 getComponents(includeProperties=true) 的重型输出。
   */
  private async fetchComponentValueByType(nodeUuid: string, componentType: string): Promise<Record<string, unknown> | null> {
    try {
      const nodeData = await requestScene('query-node', nodeUuid)
      if (!Array.isArray(nodeData.__comps__)) {
        return null
      }
      return findComponentByType(nodeData.__comps__, componentType)
    }
    catch (err) {
      console.warn(`[ComponentTools] fetchComponentValueByType failed:`, err)
      return null
    }
  }

  private async setComponentProperty(args: ComponentPropertyInput): Promise<ToolResponse> {
    const { nodeUuid, componentType, property, value } = args

    // 归一化 propertyType：大小写不敏感、支持常见别名；未传则做自动检测
    let propertyType = normalizeComponentPropertyType(args.propertyType, value)

    return new Promise(async (resolve) => {
      try {
        console.log(`[ComponentTools] Setting ${componentType}.${property} (type: ${propertyType}) = ${JSON.stringify(value)} on node ${nodeUuid}`)

        // 直接通过 query-node 拿组件的完整 value，避免 getComponents includeProperties=false 时拿不到属性的问题
        const rawComponent = await this.fetchComponentValueByType(nodeUuid, componentType)
        if (!rawComponent) {
          resolve({
            success: false,
            error: `Component '${componentType}' not found on node '${nodeUuid}'.`,
          })
          return
        }

        // Step 0: 检测是否为节点属性，如果是则重定向到对应的节点方法
        const nodeRedirectResult = getNodePropertyRedirect(args)
        if (nodeRedirectResult) {
          resolve(nodeRedirectResult)
          return
        }

        // Step 1: 已通过 query-node 拿到完整 rawComponent；在此基础上做属性分析

        // Step 2: 自动检测和转换属性值
        let propertyInfo
        try {
          console.log(`[ComponentTools] Analyzing property: ${property}`)
          propertyInfo = analyzeComponentProperty(rawComponent, property)
        }
        catch (analyzeError: unknown) {
          console.error(`[ComponentTools] Error in analyzeProperty:`, analyzeError)
          resolve({
            success: false,
            error: `Failed to analyze property '${property}': ${analyzeError instanceof Error ? analyzeError.message : String(analyzeError)}`,
          })
          return
        }

        if (!propertyInfo.exists) {
          resolve({
            success: false,
            error: `Property '${property}' not found on component '${componentType}'. Available properties: ${propertyInfo.availableProperties.join(', ')}`,
          })
          return
        }

        // 关键修正：属性的“声明类型”是权威依据。若声明为某 cc.Component 子类的引用，
        // 无论调用方传了什么 propertyType（甚至传了 cc.Node 导致语义错误），都强制走组件引用逻辑。
        // 这修复了组件类型引用字段（@property(SomeComponent)）无法写入的问题。
        if (propertyInfo.type === 'component' && propertyType !== 'component') {
          console.log(`[ComponentTools] Property '${property}' is declared as component reference (${propertyInfo.declaredType}); overriding propertyType '${propertyType}' -> 'component'`)
          propertyType = 'component'
        }

        // Step 3: 处理属性值和设置
        const originalValue = propertyInfo.originalValue
        let processedValue: unknown

        // 根据明确的propertyType处理属性值
        switch (propertyType) {
          case 'string':
            processedValue = String(value)
            break
          case 'number':
          case 'integer':
          case 'float':
            processedValue = Number(value)
            break
          case 'boolean':
            processedValue = Boolean(value)
            break
          case 'enum':
            if (typeof value === 'number' || typeof value === 'string') {
              processedValue = value
            }
            else {
              throw new TypeError('Enum value must be a number or string')
            }
            break
          case 'object':
          case 'json':
          case 'cc.ValueType':
            if (value && typeof value === 'object') {
              processedValue = value
            }
            else {
              try {
                processedValue = typeof value === 'string' ? JSON.parse(value) : value
              }
              catch {
                processedValue = value
              }
            }
            break
          case 'color':
            if (typeof value === 'string') {
              // 字符串格式：支持十六进制、颜色名称、rgb()/rgba()
              processedValue = parseComponentColor(value)
            }
            else if (typeof value === 'object' && value !== null) {
              const color = isToolArguments(value) ? value : {}
              // 对象格式：验证并转换RGBA值
              processedValue = {
                r: Math.min(255, Math.max(0, Number(color.r) || 0)),
                g: Math.min(255, Math.max(0, Number(color.g) || 0)),
                b: Math.min(255, Math.max(0, Number(color.b) || 0)),
                a: color.a !== undefined ? Math.min(255, Math.max(0, Number(color.a))) : 255,
              }
            }
            else {
              throw new Error('Color value must be an object with r, g, b properties or a hexadecimal string (e.g., "#FF0000")')
            }
            break
          case 'vec2':
            if (typeof value === 'object' && value !== null) {
              const vector = isToolArguments(value) ? value : {}
              processedValue = {
                x: Number(vector.x) || 0,
                y: Number(vector.y) || 0,
              }
            }
            else {
              throw new Error('Vec2 value must be an object with x, y properties')
            }
            break
          case 'vec3':
            if (typeof value === 'object' && value !== null) {
              const vector = isToolArguments(value) ? value : {}
              processedValue = {
                x: Number(vector.x) || 0,
                y: Number(vector.y) || 0,
                z: Number(vector.z) || 0,
              }
            }
            else {
              throw new Error('Vec3 value must be an object with x, y, z properties')
            }
            break
          case 'size':
            if (typeof value === 'object' && value !== null) {
              const size = isToolArguments(value) ? value : {}
              processedValue = {
                width: Number(size.width) || 0,
                height: Number(size.height) || 0,
              }
            }
            else {
              throw new Error('Size value must be an object with width, height properties')
            }
            break
          case 'node':
            if (typeof value === 'string') {
              processedValue = { uuid: value }
            }
            else {
              throw new TypeError('Node reference value must be a string UUID')
            }
            break
          case 'component':
            if (typeof value === 'string') {
              // 接受组件 uuid 或节点 uuid，后续在写入阶段解析为组件场景 id
              processedValue = value
            }
            else if (isToolArguments(value) && typeof value.uuid === 'string') {
              // 兼容 { uuid: "..." } 形式
              processedValue = value.uuid
            }
            else {
              throw new TypeError('Component reference value must be a string uuid (the component\'s own uuid, or the node uuid that holds it)')
            }
            break
          case 'spriteFrame':
          case 'prefab':
          case 'asset':
            if (typeof value === 'string') {
              processedValue = { uuid: value }
            }
            else if (isToolArguments(value) && typeof value.uuid === 'string') {
              processedValue = { uuid: value.uuid }
            }
            else {
              throw new TypeError(`${propertyType} value must be a UUID string or an object with a string uuid field`)
            }
            break
          case 'nodeArray':
            if (Array.isArray(value)) {
              processedValue = value.map((item) => {
                if (typeof item === 'string') {
                  return { uuid: item }
                }
                else {
                  throw new TypeError('NodeArray items must be string UUIDs')
                }
              })
            }
            else {
              throw new TypeError('NodeArray value must be an array')
            }
            break
          case 'colorArray':
            if (Array.isArray(value)) {
              processedValue = value.map((item) => {
                if (typeof item === 'object' && item !== null && 'r' in item) {
                  return {
                    r: Math.min(255, Math.max(0, Number(item.r) || 0)),
                    g: Math.min(255, Math.max(0, Number(item.g) || 0)),
                    b: Math.min(255, Math.max(0, Number(item.b) || 0)),
                    a: item.a !== undefined ? Math.min(255, Math.max(0, Number(item.a))) : 255,
                  }
                }
                else {
                  return { r: 255, g: 255, b: 255, a: 255 }
                }
              })
            }
            else {
              throw new TypeError('ColorArray value must be an array')
            }
            break
          case 'numberArray':
            if (Array.isArray(value)) {
              processedValue = value.map(item => Number(item))
            }
            else {
              throw new TypeError('NumberArray value must be an array')
            }
            break
          case 'stringArray':
            if (Array.isArray(value)) {
              processedValue = value.map(item => String(item))
            }
            else {
              throw new TypeError('StringArray value must be an array')
            }
            break
          default: {
            // 兜底：尝试根据 value 自动推导类型
            const inferred = inferComponentPropertyType(value, property, propertyInfo)
            if (inferred) {
              console.log(`[ComponentTools] Inferred type for property '${property}': ${inferred}`)
              processedValue = processComponentTypedValue(value, inferred)
              break
            }
            throw new Error(buildUnsupportedComponentPropertyTypeError(propertyType, value))
          }
        }

        console.log(`[ComponentTools] Converting value: ${JSON.stringify(value)} -> ${JSON.stringify(processedValue)} (type: ${propertyType})`)
        console.log(`[ComponentTools] Property analysis result: propertyInfo.type="${propertyInfo.type}", propertyType="${propertyType}"`)
        console.log(`[ComponentTools] Will use color special handling: ${propertyType === 'color' && processedValue && typeof processedValue === 'object'}`)

        // 用于验证的实际期望值（对于组件引用需要特殊处理）
        let actualExpectedValue = processedValue

        // Step 5: 获取原始节点数据来构建正确的路径
        const rawNodeData = await requestScene('query-node', nodeUuid)
        if (!Array.isArray(rawNodeData.__comps__)) {
          resolve({
            success: false,
            error: `Failed to get raw node data for property setting`,
          })
          return
        }

        // 找到原始组件的索引
        // query-node 返回的 __comps__ 元素可能把"实际类名"放在不同字段：
        //   - 自定义组件常在 `type`（如 'Emitter'），而 `__type__` 是父类 'cc.Script'
        //   - 内置组件常在 `__type__`（如 'cc.Sprite'）
        //   - 有时类名在 `value.name`（'Emitter<UITransform>' 形式）
        // 因此多字段依次匹配，兼容多种形态。
        const rawComponentIndex = findComponentIndexByType(rawNodeData.__comps__, componentType)

        if (rawComponentIndex === -1) {
          // 给出更详细的诊断信息，方便用户排查
          const availableTypes = rawNodeData.__comps__.map(component => getComponentType(component) ?? 'Unknown')
          resolve({
            success: false,
            error: `Could not find component index for setting property: requested '${componentType}', available types: [${availableTypes.join(', ')}]`,
          })
          return
        }

        // 构建正确的属性路径
        const propertyPath = resolveComponentPropertyPath(rawComponentIndex, property, propertyInfo.declaredPath)

        // 特殊处理资源类属性
        if (propertyType === 'asset' || propertyType === 'spriteFrame' || propertyType === 'prefab'
          || (propertyInfo.type === 'asset' && propertyType === 'string')) {
          console.log(`[ComponentTools] Setting asset reference:`, {
            value: processedValue,
            property,
            propertyType,
            path: propertyPath,
          })

          const assetType = resolveComponentAssetType(property, propertyType, propertyInfo)
          const requestedAssetUuid = isToolArguments(processedValue) && typeof processedValue.uuid === 'string'
            ? processedValue.uuid
            : String(value)
          const assetInfo = await requestAssetDb('query-asset-info', requestedAssetUuid).catch(() => null)
          if (!assetInfo) {
            throw new Error(`Asset UUID '${requestedAssetUuid}' was not found by Cocos asset-db. Query the asset again after import/refresh and use the UUID returned by asset-db.`)
          }
          const canonicalAsset = resolveCanonicalAssetReference(assetInfo, assetType)
          if (!canonicalAsset) {
            const actualType = typeof assetInfo.type === 'string' ? assetInfo.type : 'unknown'
            throw new Error(`Asset '${requestedAssetUuid}' is not compatible with ${assetType} (asset-db type: ${actualType}). Query the source asset with sub-assets included and use the matching sub-asset UUID.`)
          }
          processedValue = { uuid: canonicalAsset.uuid }
          actualExpectedValue = processedValue

          const changed = await requestScene('set-property', {
            uuid: nodeUuid,
            path: propertyPath,
            dump: {
              value: processedValue,
              type: assetType,
              ...(propertyInfo.isArray === undefined ? {} : { isArray: propertyInfo.isArray }),
            },
          })
          if (!changed) {
            throw new Error(`Cocos Editor rejected the asset reference write for '${propertyPath}'. Verify that '${canonicalAsset.uuid}' is the UUID of the expected sub-asset (${assetType}), not the source image UUID.`)
          }
        }
        else if (componentType === 'cc.UITransform' && (property === '_contentSize' || property === 'contentSize')) {
          const size = isToolArguments(value) ? value : {}
          // Special handling for UITransform contentSize - set width and height separately
          const width = Number(size.width) || 100
          const height = Number(size.height) || 100

          // Set width first
          await requestScene('set-property', {
            uuid: nodeUuid,
            path: `__comps__.${rawComponentIndex}.width`,
            dump: { value: width },
          })

          // Then set height
          await requestScene('set-property', {
            uuid: nodeUuid,
            path: `__comps__.${rawComponentIndex}.height`,
            dump: { value: height },
          })
        }
        else if (componentType === 'cc.UITransform' && (property === '_anchorPoint' || property === 'anchorPoint')) {
          const anchor = isToolArguments(value) ? value : {}
          // Special handling for UITransform anchorPoint - set anchorX and anchorY separately
          const anchorX = Number(anchor.x) || 0.5
          const anchorY = Number(anchor.y) || 0.5

          // Set anchorX first
          await requestScene('set-property', {
            uuid: nodeUuid,
            path: `__comps__.${rawComponentIndex}.anchorX`,
            dump: { value: anchorX },
          })

          // Then set anchorY
          await requestScene('set-property', {
            uuid: nodeUuid,
            path: `__comps__.${rawComponentIndex}.anchorY`,
            dump: { value: anchorY },
          })
        }
        else if (propertyType === 'color' && processedValue && typeof processedValue === 'object') {
          const color = isToolArguments(processedValue) ? processedValue : {}
          // 特殊处理颜色属性，确保RGBA值正确
          // Cocos Creator颜色值范围是0-255
          const colorValue = {
            r: Math.min(255, Math.max(0, Number(color.r) || 0)),
            g: Math.min(255, Math.max(0, Number(color.g) || 0)),
            b: Math.min(255, Math.max(0, Number(color.b) || 0)),
            a: color.a !== undefined ? Math.min(255, Math.max(0, Number(color.a))) : 255,
          }

          console.log(`[ComponentTools] Setting color value:`, colorValue)

          await requestScene('set-property', {
            uuid: nodeUuid,
            path: propertyPath,
            dump: {
              value: colorValue,
              type: 'cc.Color',
            },
          })
        }
        else if (propertyType === 'vec3' && processedValue && typeof processedValue === 'object') {
          const vector = isToolArguments(processedValue) ? processedValue : {}
          // 特殊处理Vec3属性
          const vec3Value = {
            x: Number(vector.x) || 0,
            y: Number(vector.y) || 0,
            z: Number(vector.z) || 0,
          }

          await requestScene('set-property', {
            uuid: nodeUuid,
            path: propertyPath,
            dump: {
              value: vec3Value,
              type: 'cc.Vec3',
            },
          })
        }
        else if (propertyType === 'vec2' && processedValue && typeof processedValue === 'object') {
          const vector = isToolArguments(processedValue) ? processedValue : {}
          // 特殊处理Vec2属性
          const vec2Value = {
            x: Number(vector.x) || 0,
            y: Number(vector.y) || 0,
          }

          await requestScene('set-property', {
            uuid: nodeUuid,
            path: propertyPath,
            dump: {
              value: vec2Value,
              type: 'cc.Vec2',
            },
          })
        }
        else if (propertyType === 'size' && processedValue && typeof processedValue === 'object') {
          const size = isToolArguments(processedValue) ? processedValue : {}
          // 特殊处理Size属性
          const sizeValue = {
            width: Number(size.width) || 0,
            height: Number(size.height) || 0,
          }

          await requestScene('set-property', {
            uuid: nodeUuid,
            path: propertyPath,
            dump: {
              value: sizeValue,
              type: 'cc.Size',
            },
          })
        }
        else if (propertyType === 'node' && processedValue && typeof processedValue === 'object' && 'uuid' in processedValue) {
          // 特殊处理节点引用
          console.log(`[ComponentTools] Setting node reference with UUID: ${processedValue.uuid}`)
          await requestScene('set-property', {
            uuid: nodeUuid,
            path: propertyPath,
            dump: {
              value: processedValue,
              type: 'cc.Node',
            },
          })
        }
        else if (propertyType === 'component' && typeof processedValue === 'string') {
          // 组件引用写入：接受「组件 uuid」或「节点 uuid」两种输入
          //   - 组件 uuid（node_query.get_info 返回的组件 uuid）→ 直接定位该 Component 实例
          //   - 节点 uuid → 在该节点上按声明类型 getComponent 取实例
          // 写入格式与节点/资源引用一致：{ value: { uuid: <组件场景id> }, type: <声明类型> }
          const inputUuid = processedValue

          // 声明类型是权威依据（来自 query-node dump 的 type 字段），兜底回退到属性元数据
          let expectedComponentType = propertyInfo.declaredType || ''
          if (!expectedComponentType || expectedComponentType === 'cc.Component') {
            const currentComponentInfo = await this.getComponentInfo(nodeUuid, componentType)
            const propertyMeta = currentComponentInfo.data?.properties?.[property]
            if (propertyMeta && typeof propertyMeta === 'object') {
              if (propertyMeta.type) {
                expectedComponentType = propertyMeta.type
              }
              else if (propertyMeta.ctor) {
                expectedComponentType = propertyMeta.ctor
              }
              else if (Array.isArray(propertyMeta.extends)) {
                for (const extendType of propertyMeta.extends) {
                  if (extendType.startsWith('cc.') && extendType !== 'cc.Component' && extendType !== 'cc.Object') {
                    expectedComponentType = extendType
                    break
                  }
                }
              }
            }
          }

          console.log(`[ComponentTools] Setting component reference: input=${inputUuid}, expectedType=${expectedComponentType || '(unknown)'}`)

          // 取组件在场景中的 id（写引用用的就是这个）
          let componentId: string | null = null

          // 情形 A：输入是节点 uuid —— 在该节点上找声明类型的组件
          const asNode = await requestScene('query-node', inputUuid).catch(() => null)
          if (asNode && Array.isArray(asNode.__comps__)) {
            let matched = expectedComponentType
              ? asNode.__comps__.find(component => componentMatchesType(component, expectedComponentType))
              : null
            // 若无法确定声明类型，且该节点只有一个自定义脚本组件，直接用它
            if (!matched && !expectedComponentType && asNode.__comps__.length === 1) {
              matched = asNode.__comps__[0]
            }
            if (matched) {
              componentId = getComponentSceneId(matched)
            }
            else if (expectedComponentType) {
              const available = asNode.__comps__.map(describeComponent).join(', ')
              throw new Error(`Component type '${expectedComponentType}' not found on node ${inputUuid}. Available: ${available}`)
            }
          }

          // 情形 B：输入本身就是组件 uuid（节点查不到 __comps__），直接使用
          if (!componentId) {
            componentId = inputUuid
            console.log(`[ComponentTools] Input treated as component uuid directly: ${componentId}`)
          }

          actualExpectedValue = { uuid: componentId }

          const dump: { value: { uuid: string }, type?: string } = { value: { uuid: componentId } }
          if (expectedComponentType) {
            dump.type = expectedComponentType
          }

          // Quirk 修复：组件引用字段若已有值，直接覆盖会被 Cocos 静默写成 null。
          // 先把字段清空为 null（带上声明类型让引擎识别字段），再写入新引用。
          // 兼容旧引擎的 { __id__: number } / { __uuid__: string } 引用格式（#quirk-02）
          const existingRef = propertyInfo.originalValue
          const existingReference = existingRef && typeof existingRef === 'object'
            ? existingRef as Record<string, unknown>
            : null
          const nestedReference = existingReference?.value && typeof existingReference.value === 'object'
            ? existingReference.value as Record<string, unknown>
            : null
          const hasExistingRef = existingReference !== null
            && (existingReference.uuid != null
              || existingReference.__id__ != null
              || existingReference.__uuid__ != null
              || (nestedReference !== null && (
                nestedReference.uuid != null
                || nestedReference.__id__ != null
                || nestedReference.__uuid__ != null
              )))
          if (hasExistingRef) {
            console.log(`[ComponentTools] Component ref '${property}' already has a value; clearing to null before overwrite`)
            const clearDump: { value: null, type?: string } = { value: null }
            if (expectedComponentType) {
              clearDump.type = expectedComponentType
            }
            await requestScene('set-property', {
              uuid: nodeUuid,
              path: propertyPath,
              dump: clearDump,
            })
            await new Promise(res => setTimeout(res, 50))
          }

          await requestScene('set-property', {
            uuid: nodeUuid,
            path: propertyPath,
            dump,
          })
        }
        else if (propertyType === 'nodeArray' && Array.isArray(processedValue)) {
          // 特殊处理节点数组 - 保持预处理的格式
          console.log(`[ComponentTools] Setting node array:`, processedValue)

          await requestScene('set-property', {
            uuid: nodeUuid,
            path: propertyPath,
            dump: {
              value: processedValue, // 保持 [{uuid: "..."}, {uuid: "..."}] 格式
            },
          })
        }
        else if (propertyType === 'colorArray' && Array.isArray(processedValue)) {
          // 特殊处理颜色数组
          const colorArrayValue = processedValue.map((item) => {
            if (item && typeof item === 'object' && 'r' in item) {
              return {
                r: Math.min(255, Math.max(0, Number(item.r) || 0)),
                g: Math.min(255, Math.max(0, Number(item.g) || 0)),
                b: Math.min(255, Math.max(0, Number(item.b) || 0)),
                a: item.a !== undefined ? Math.min(255, Math.max(0, Number(item.a))) : 255,
              }
            }
            else {
              return { r: 255, g: 255, b: 255, a: 255 }
            }
          })

          await requestScene('set-property', {
            uuid: nodeUuid,
            path: propertyPath,
            dump: {
              value: colorArrayValue,
              type: 'cc.Color',
            },
          })
        }
        else {
          // Normal property setting for non-asset properties
          await requestScene('set-property', {
            uuid: nodeUuid,
            path: propertyPath,
            dump: { value: processedValue },
          })
        }

        // Step 5: 等待Editor完成更新，然后验证设置结果
        await new Promise(resolve => setTimeout(resolve, 200)) // 等待200ms让Editor完成更新

        const strictReferenceVerification = propertyInfo.type === 'asset'
          || propertyType === 'asset'
          || propertyType === 'spriteFrame'
          || propertyType === 'prefab'
        const verification = await this.verifyPropertyChange(nodeUuid, componentType, property, originalValue, actualExpectedValue, strictReferenceVerification)

        if (strictReferenceVerification && !verification.verified) {
          resolve(toolFailure(`Asset reference verification failed for ${componentType}.${property}.`, {
            data: {
              nodeUuid,
              componentType,
              property,
              expectedValue: actualExpectedValue,
              actualValue: verification.actualValue,
              changeVerified: false,
            },
            instruction: 'Query the asset first and retry with the exact sub-asset UUID returned by Cocos. For an imported image, use its SpriteFrame sub-asset UUID rather than the source image UUID.',
          }))
          return
        }

        resolve({
          success: true,
          message: `Successfully set ${componentType}.${property}`,
          data: {
            nodeUuid,
            componentType,
            property,
            actualValue: verification.actualValue,
            changeVerified: verification.verified,
          },
        })
      }
      catch (error: unknown) {
        console.error(`[ComponentTools] Error setting property:`, error)
        resolve({
          success: false,
          error: `Failed to set property: ${error instanceof Error ? error.message : String(error)}`,
        })
      }
    })
  }

  private async attachScript(nodeUuid: string, scriptPath: string): Promise<ToolResponse> {
    return new Promise(async (resolve) => {
      // 从脚本路径提取组件类名
      const scriptName = scriptPath.split('/').pop()?.replace('.ts', '').replace('.js', '')
      if (!scriptName) {
        resolve({ success: false, error: 'Invalid script path' })
        return
      }
      // 先查找节点上是否已存在该脚本组件
      const allComponentsInfo = await this.getComponents(nodeUuid)
      if (allComponentsInfo.success && allComponentsInfo.data?.components) {
        // 改进查找逻辑：同时检查 type、name 和 cid 字段
        const existingScript = allComponentsInfo.data.components.find((comp: unknown) => isScriptComponent(comp, scriptName))
        if (existingScript) {
          resolve({
            success: true,
            message: `Script '${scriptName}' already exists on node`,
            data: {
              nodeUuid,
              componentName: scriptName,
              existing: true,
              actualType: existingScript.type,
            },
          })
          return
        }
      }
      // 首先尝试直接使用脚本名称作为组件类型
      Editor.Message.request('scene', 'create-component', {
        uuid: nodeUuid,
        component: scriptName, // 使用脚本名称而非UUID
      }).then(async () => {
        // 等待一段时间让Editor完成组件添加
        await new Promise(resolve => setTimeout(resolve, 100))
        // 重新查询节点信息验证脚本是否真的添加成功
        const allComponentsInfo2 = await this.getComponents(nodeUuid)
        if (allComponentsInfo2.success && allComponentsInfo2.data?.components) {
          // 改进验证逻辑：同时检查 type、name 和 cid 字段
          const addedScript = allComponentsInfo2.data.components.find((comp: unknown) => isScriptComponent(comp, scriptName))
          if (addedScript) {
            resolve({
              success: true,
              message: `Script '${scriptName}' attached successfully`,
              data: {
                nodeUuid,
                componentName: scriptName,
                existing: false,
                actualType: addedScript.type,
              },
            })
          }
          else {
            resolve({
              success: false,
              error: `Script '${scriptName}' was not found on node after addition. Available components: ${allComponentsInfo2.data.components.map((component: unknown) => getComponentType(component) ?? 'Unknown').join(', ')}`,
            })
          }
        }
        else {
          resolve({
            success: false,
            error: `Failed to verify script addition: ${allComponentsInfo2.error || 'Unable to get node components'}`,
          })
        }
      }).catch((err: Error) => {
        // 备用方案：使用场景脚本
        const options = {
          name: 'cocos-mcp-server',
          method: 'attachScript',
          args: [nodeUuid, scriptPath],
        }
        Editor.Message.request('scene', 'execute-scene-script', options).then((result: unknown) => {
          resolve(isToolArguments(result) && typeof result.success === 'boolean' ? result as unknown as ToolResponse : toolFailure('Scene script returned an invalid response'))
        }).catch(() => {
          resolve({
            success: false,
            error: `Failed to attach script '${scriptName}': ${err.message}`,
            instruction: 'Please ensure the script is properly compiled and exported as a Component class. You can also manually attach the script through the Properties panel in the editor.',
          })
        })
      })
    })
  }

  private async getAvailableComponents(category: string = 'all'): Promise<ToolResponse> {
    const componentCategories: Record<string, string[]> = {
      renderer: ['cc.Sprite', 'cc.Label', 'cc.RichText', 'cc.Mask', 'cc.Graphics'],
      ui: ['cc.Button', 'cc.Toggle', 'cc.Slider', 'cc.ScrollView', 'cc.EditBox', 'cc.ProgressBar'],
      physics: ['cc.RigidBody2D', 'cc.BoxCollider2D', 'cc.CircleCollider2D', 'cc.PolygonCollider2D'],
      animation: ['cc.Animation', 'cc.AnimationClip', 'cc.SkeletalAnimation'],
      audio: ['cc.AudioSource'],
      layout: ['cc.Layout', 'cc.Widget', 'cc.PageView', 'cc.PageViewIndicator'],
      effects: ['cc.MotionStreak', 'cc.ParticleSystem2D'],
      camera: ['cc.Camera'],
      light: ['cc.Light', 'cc.DirectionalLight', 'cc.PointLight', 'cc.SpotLight'],
    }

    let components: string[] = []

    if (category === 'all') {
      for (const cat in componentCategories) {
        components = components.concat(componentCategories[cat])
      }
    }
    else if (componentCategories[category]) {
      components = componentCategories[category]
    }

    return {
      success: true,
      data: {
        category,
        components,
      },
    }
  }

  private async verifyPropertyChange(nodeUuid: string, componentType: string, property: string, originalValue: unknown, expectedValue: unknown, strictReference: boolean = false): Promise<ComponentPropertyVerification> {
    console.log(`[verifyPropertyChange] Starting verification for ${componentType}.${property}`)
    console.log(`[verifyPropertyChange] Expected value:`, JSON.stringify(expectedValue))
    console.log(`[verifyPropertyChange] Original value:`, JSON.stringify(originalValue))

    try {
      // 重新获取组件信息进行验证
      console.log(`[verifyPropertyChange] Calling getComponentInfo...`)
      const componentInfo = await this.getComponentInfo(nodeUuid, componentType)
      console.log(`[verifyPropertyChange] getComponentInfo success:`, componentInfo.success)

      if (componentInfo.success && componentInfo.data) {
        const propertyData = componentInfo.data.properties?.[property]

        const actualValue = unwrapPropertyDumpValue(propertyData)
        const verified = verifyComponentPropertyValue(actualValue, expectedValue, originalValue, strictReference)

        const result = {
          verified,
          actualValue,
          fullData: {
            // 只返回修改的属性信息，不返回完整组件数据
            modifiedProperty: {
              name: property,
              before: originalValue,
              expected: expectedValue,
              actual: actualValue,
              verified,
              propertyMetadata: propertyData, // 只包含这个属性的元数据
            },
            // 简化的组件信息
            componentSummary: {
              nodeUuid,
              componentType,
              totalProperties: Object.keys(componentInfo.data?.properties || {}).length,
            },
          },
        }

        return result
      }
      else {
        console.log(`[verifyPropertyChange] ComponentInfo failed or no data:`, componentInfo)
      }
    }
    catch (error) {
      console.error('[verifyPropertyChange] Verification failed with error:', error)
      console.error('[verifyPropertyChange] Error stack:', error instanceof Error ? error.stack : 'No stack trace')
    }

    console.log(`[verifyPropertyChange] Returning fallback result`)
    return {
      verified: false,
      actualValue: undefined,
      fullData: null,
    }
  }

  /**
   * 快速验证资源设置结果
   */
  private async quickVerifyAsset(nodeUuid: string, componentType: string, property: string): Promise<unknown> {
    try {
      const rawNodeData = await requestScene('query-node', nodeUuid)
      if (!rawNodeData.__comps__) {
        return null
      }

      const component = findComponentByType(rawNodeData.__comps__, componentType)

      if (!component) {
        return null
      }

      // 提取属性值
      const properties = extractComponentProperties(component)
      const propertyData = properties[property]

      if (propertyData && typeof propertyData === 'object' && 'value' in propertyData) {
        return propertyData.value
      }
      else {
        return propertyData
      }
    }
    catch (error) {
      console.error(`[quickVerifyAsset] Error:`, error)
      return null
    }
  }
}
