import type { ToolDefinition, ToolExecutor, ToolResponse } from '../types'

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
        description: 'Remove a component from a node. componentType must be the component\'s classId (cid, i.e. the type field from getComponents), not the script name or class name. Use getComponents to get the correct cid.',
        inputSchema: {
          type: 'object',
          properties: {
            nodeUuid: {
              type: 'string',
              description: 'Node UUID',
            },
            componentType: {
              type: 'string',
              description: 'Component cid (type field from getComponents). Do NOT use script name or class name. Example: "cc.Sprite" or "9b4a7ueT9xD6aRE+AlOusy1"',
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
                + '• component: "target-node-uuid" (component reference)\n'
                + '  How it works: \n'
                + '    1. Provide the UUID of the NODE that contains the target component\n'
                + '    2. System auto-detects required component type from property metadata\n'
                + '    3. Finds the component on target node and gets its scene __id__\n'
                + '    4. Sets reference using the scene __id__ (not node UUID)\n'
                + '  Example: value="label-node-uuid" will find cc.Label and use its scene ID\n'
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

  async execute(toolName: string, args: any): Promise<ToolResponse> {
    switch (toolName) {
      case 'add_component':
        return await this.addComponent(args.nodeUuid, args.componentType)
      case 'remove_component':
        return await this.removeComponent(args.nodeUuid, args.componentType)
      case 'get_components':
        return await this.getComponents(args.nodeUuid, args.includeProperties === true)
      case 'get_component_info':
        return await this.getComponentInfo(args.nodeUuid, args.componentType)
      case 'set_component_property':
        return await this.setComponentProperty(args)
      case 'attach_script':
        return await this.attachScript(args.nodeUuid, args.scriptPath)
      case 'get_available_components':
        return await this.getAvailableComponents(args.category)
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
      const assetInfo: any = await Editor.Message.request('asset-db', 'query-asset-info', uuid)
      if (assetInfo && assetInfo.type === 'script' && assetInfo.name) {
        return assetInfo.name
      }
      if (assetInfo && assetInfo.asset && assetInfo.asset.name) {
        return assetInfo.asset.name
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
        const existingComponent = allComponentsInfo.data.components.find((comp: any) => {
          const compType = comp.type || ''
          return compType === effectiveComponentType
        })
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
      }).then(async (result: any) => {
        // 等待一段时间让Editor完成组件添加
        await new Promise(resolve => setTimeout(resolve, 200))
        // 重新查询节点信息验证组件是否真的添加成功
        try {
          const allComponentsInfo2 = await this.getComponents(nodeUuid)

          if (allComponentsInfo2.success && allComponentsInfo2.data?.components) {
            const addedComponent = allComponentsInfo2.data.components.find((comp: any) => {
              const compType = comp.type || ''
              if (effectiveComponentType.startsWith('cc.')) {
                return compType === effectiveComponentType
                  || compType.replace('cc.', '') === effectiveComponentType.replace('cc.', '')
              }
              return compType === effectiveComponentType
            })
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
            else {
              const componentList = allComponentsInfo2.data.components.map((c: any) =>
                `type:${c.type}, name:${c.name}`,
              ).join('; ')
              resolve({
                success: false,
                error: `Component '${effectiveComponentType}' was not found on node after addition. Available components: ${componentList}`,
              })
            }
          }
          else {
            resolve({
              success: false,
              error: `Failed to verify component addition: ${allComponentsInfo2.error || 'Unable to get node components'}`,
            })
          }
        }
        catch (verifyError: any) {
          resolve({
            success: false,
            error: `Failed to verify component addition: ${verifyError.message}`,
          })
        }
      }).catch((err: Error) => {
        // 备用方案：使用场景脚本
        const options = {
          name: 'cocos-mcp-server',
          method: 'addComponentToNode',
          args: [nodeUuid, effectiveComponentType],
        }
        Editor.Message.request('scene', 'execute-scene-script', options).then((result: any) => {
          resolve(result)
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
      // 2. 只查找type字段等于componentType的组件（即cid）
      const exists = allComponentsInfo.data.components.some((comp: any) => comp.type === componentType)
      if (!exists) {
        resolve({ success: false, error: `Component cid '${componentType}' not found on node '${nodeUuid}'. 请用getComponents获取type字段（cid）作为componentType。` })
        return
      }
      // 3. 官方API直接移除
      try {
        await Editor.Message.request('scene', 'remove-component', {
          uuid: nodeUuid,
          component: componentType,
        })
        // 4. 再查一次确认是否移除
        const afterRemoveInfo = await this.getComponents(nodeUuid)
        const stillExists = afterRemoveInfo.success && afterRemoveInfo.data?.components?.some((comp: any) => comp.type === componentType)
        if (stillExists) {
          resolve({ success: false, error: `Component cid '${componentType}' was not removed from node '${nodeUuid}'.` })
        }
        else {
          resolve({
            success: true,
            message: `Component cid '${componentType}' removed successfully from node '${nodeUuid}'`,
            data: { nodeUuid, componentType },
          })
        }
      }
      catch (err: any) {
        resolve({ success: false, error: `Failed to remove component: ${err.message}` })
      }
    })
  }

  private async getComponents(nodeUuid: string, includeProperties: boolean = false): Promise<ToolResponse> {
    return new Promise((resolve) => {
      // 优先尝试直接使用 Editor API 查询节点信息
      Editor.Message.request('scene', 'query-node', nodeUuid).then((nodeData: any) => {
        if (nodeData && nodeData.__comps__) {
          const components = nodeData.__comps__.map((comp: any) => {
            // 提取组件名称：
            // - 对于脚本组件，comp.type 就是脚本名称（如 'GameManager'）
            // - 对于内置组件，comp.cid 是类型（如 'cc.UITransform'）
            // - 也可以从 comp.value?.name 读取
            const extractedName = comp.value?.name
              || comp.type
              || comp.cid
              || ''

            const result: any = {
              // type: 对于脚本组件是脚本名，对于内置组件是 cid
              type: comp.type || comp.cid || comp.__type__ || 'Unknown',
              name: extractedName,
              uuid: comp.uuid?.value || comp.uuid || null,
              enabled: comp.enabled !== undefined ? comp.enabled : true,
            }

            // 默认不返回 properties，保持负载轻量；显式 includeProperties=true 时才展开完整属性
            if (includeProperties) {
              result.properties = this.extractComponentProperties(comp)
            }

            return result
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

        Editor.Message.request('scene', 'execute-scene-script', options).then((result: any) => {
          if (result.success) {
            resolve({
              success: true,
              data: result.data.components,
            })
          }
          else {
            resolve(result)
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
      Editor.Message.request('scene', 'query-node', nodeUuid).then((nodeData: any) => {
        if (nodeData && nodeData.__comps__) {
          const component = nodeData.__comps__.find((comp: any) => {
            const compType = comp.__type__ || comp.cid || comp.type
            return compType === componentType
          })

          if (component) {
            resolve({
              success: true,
              data: {
                nodeUuid,
                componentType,
                enabled: component.enabled !== undefined ? component.enabled : true,
                properties: this.extractComponentProperties(component),
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

        Editor.Message.request('scene', 'execute-scene-script', options).then((result: any) => {
          if (result.success && result.data.components) {
            const component = result.data.components.find((comp: any) => comp.type === componentType)
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
            resolve({ success: false, error: result.error || 'Failed to get component info' })
          }
        }).catch((err2: Error) => {
          resolve({ success: false, error: `Direct API failed: ${err.message}, Scene script failed: ${err2.message}` })
        })
      })
    })
  }

  private extractComponentProperties(component: any): Record<string, any> {
    console.log(`[extractComponentProperties] Processing component:`, Object.keys(component))

    // 检查组件是否有 value 属性，这通常包含实际的组件属性
    if (component.value && typeof component.value === 'object') {
      console.log(`[extractComponentProperties] Found component.value with properties:`, Object.keys(component.value))
      return component.value // 直接返回 value 对象，它包含所有组件属性
    }

    // 备用方案：从组件对象中直接提取属性
    const properties: Record<string, any> = {}
    const excludeKeys = ['__type__', 'enabled', 'node', '_id', '__scriptAsset', 'uuid', 'name', '_name', '_objFlags', '_enabled', 'type', 'readonly', 'visible', 'cid', 'editor', 'extends']

    for (const key in component) {
      if (!excludeKeys.includes(key) && !key.startsWith('_')) {
        console.log(`[extractComponentProperties] Found direct property '${key}':`, typeof component[key])
        properties[key] = component[key]
      }
    }

    console.log(`[extractComponentProperties] Final extracted properties:`, Object.keys(properties))
    return properties
  }

  private async findComponentTypeByUuid(componentUuid: string): Promise<string | null> {
    console.log(`[findComponentTypeByUuid] Searching for component type with UUID: ${componentUuid}`)
    if (!componentUuid) {
      return null
    }
    try {
      const nodeTree = await Editor.Message.request('scene', 'query-node-tree')
      if (!nodeTree) {
        console.warn('[findComponentTypeByUuid] Failed to query node tree.')
        return null
      }

      const queue: any[] = [nodeTree]

      while (queue.length > 0) {
        const currentNodeInfo = queue.shift()
        if (!currentNodeInfo || !currentNodeInfo.uuid) {
          continue
        }

        try {
          const fullNodeData = await Editor.Message.request('scene', 'query-node', currentNodeInfo.uuid)
          if (fullNodeData && fullNodeData.__comps__) {
            for (const comp of fullNodeData.__comps__) {
              const compAny = comp as any // Cast to any to access dynamic properties
              // The component UUID is nested in the 'value' property
              if (compAny.uuid && compAny.uuid.value === componentUuid) {
                const componentType = compAny.__type__
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
  private async fetchComponentValueByType(nodeUuid: string, componentType: string): Promise<any | null> {
    try {
      const nodeData: any = await Editor.Message.request('scene', 'query-node', nodeUuid)
      if (!nodeData || !Array.isArray(nodeData.__comps__)) {
        return null
      }
      return nodeData.__comps__.find((c: any) => {
        if (c.cid === componentType)
          return true
        if (c.__type__ === componentType)
          return true
        if (c.type === componentType)
          return true
        // 内置组件允许省略 cc. 前缀
        if (componentType.startsWith('cc.')) {
          return c.cid === componentType
            || c.cid === componentType.replace(/^cc\./, '')
        }
        return false
      }) ?? null
    }
    catch (err) {
      console.warn(`[ComponentTools] fetchComponentValueByType failed:`, err)
      return null
    }
  }

  private async setComponentProperty(args: any): Promise<ToolResponse> {
    const { nodeUuid, componentType, property, value } = args

    // 归一化 propertyType：大小写不敏感、支持常见别名；未传则做自动检测
    const propertyType = this.normalizePropertyType(args.propertyType, value)

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
        const nodeRedirectResult = await this.checkAndRedirectNodeProperties(args)
        if (nodeRedirectResult) {
          resolve(nodeRedirectResult)
          return
        }

        // Step 1: 已通过 query-node 拿到完整 rawComponent；在此基础上做属性分析

        // Step 2: 自动检测和转换属性值
        let propertyInfo
        try {
          console.log(`[ComponentTools] Analyzing property: ${property}`)
          propertyInfo = this.analyzeProperty(rawComponent, property)
        }
        catch (analyzeError: any) {
          console.error(`[ComponentTools] Error in analyzeProperty:`, analyzeError)
          resolve({
            success: false,
            error: `Failed to analyze property '${property}': ${analyzeError.message}`,
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

        // Step 3: 处理属性值和设置
        const originalValue = propertyInfo.originalValue
        let processedValue: any

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
              processedValue = this.parseColorString(value)
            }
            else if (typeof value === 'object' && value !== null) {
              // 对象格式：验证并转换RGBA值
              processedValue = {
                r: Math.min(255, Math.max(0, Number(value.r) || 0)),
                g: Math.min(255, Math.max(0, Number(value.g) || 0)),
                b: Math.min(255, Math.max(0, Number(value.b) || 0)),
                a: value.a !== undefined ? Math.min(255, Math.max(0, Number(value.a))) : 255,
              }
            }
            else {
              throw new Error('Color value must be an object with r, g, b properties or a hexadecimal string (e.g., "#FF0000")')
            }
            break
          case 'vec2':
            if (typeof value === 'object' && value !== null) {
              processedValue = {
                x: Number(value.x) || 0,
                y: Number(value.y) || 0,
              }
            }
            else {
              throw new Error('Vec2 value must be an object with x, y properties')
            }
            break
          case 'vec3':
            if (typeof value === 'object' && value !== null) {
              processedValue = {
                x: Number(value.x) || 0,
                y: Number(value.y) || 0,
                z: Number(value.z) || 0,
              }
            }
            else {
              throw new Error('Vec3 value must be an object with x, y, z properties')
            }
            break
          case 'size':
            if (typeof value === 'object' && value !== null) {
              processedValue = {
                width: Number(value.width) || 0,
                height: Number(value.height) || 0,
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
              // 组件引用需要特殊处理：通过节点UUID找到组件的__id__
              processedValue = value // 先保存节点UUID，后续会转换为__id__
            }
            else {
              throw new TypeError('Component reference value must be a string (node UUID containing the target component)')
            }
            break
          case 'spriteFrame':
          case 'prefab':
          case 'asset':
            if (typeof value === 'string') {
              processedValue = { uuid: value }
            }
            else {
              throw new TypeError(`${propertyType} value must be a string UUID`)
            }
            break
          case 'nodeArray':
            if (Array.isArray(value)) {
              processedValue = value.map((item: any) => {
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
              processedValue = value.map((item: any) => {
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
              processedValue = value.map((item: any) => Number(item))
            }
            else {
              throw new TypeError('NumberArray value must be an array')
            }
            break
          case 'stringArray':
            if (Array.isArray(value)) {
              processedValue = value.map((item: any) => String(item))
            }
            else {
              throw new TypeError('StringArray value must be an array')
            }
            break
          default: {
            // 兜底：尝试根据 value 自动推导类型
            const inferred = this.inferTypeFromValue(value, property, propertyInfo)
            if (inferred) {
              console.log(`[ComponentTools] Inferred type for property '${property}': ${inferred}`)
              processedValue = this.processTypedValue(value, inferred, property, propertyInfo)
              break
            }
            throw new Error(this.buildUnsupportedPropertyTypeError(propertyType, value))
          }
        }

        console.log(`[ComponentTools] Converting value: ${JSON.stringify(value)} -> ${JSON.stringify(processedValue)} (type: ${propertyType})`)
        console.log(`[ComponentTools] Property analysis result: propertyInfo.type="${propertyInfo.type}", propertyType="${propertyType}"`)
        console.log(`[ComponentTools] Will use color special handling: ${propertyType === 'color' && processedValue && typeof processedValue === 'object'}`)

        // 用于验证的实际期望值（对于组件引用需要特殊处理）
        let actualExpectedValue = processedValue

        // Step 5: 获取原始节点数据来构建正确的路径
        const rawNodeData = await Editor.Message.request('scene', 'query-node', nodeUuid)
        if (!rawNodeData || !rawNodeData.__comps__) {
          resolve({
            success: false,
            error: `Failed to get raw node data for property setting`,
          })
          return
        }

        // 找到原始组件的索引
        let rawComponentIndex = -1
        for (let i = 0; i < rawNodeData.__comps__.length; i++) {
          const comp = rawNodeData.__comps__[i] as any
          const compType = comp.__type__ || comp.cid || comp.type || 'Unknown'
          if (compType === componentType) {
            rawComponentIndex = i
            break
          }
        }

        if (rawComponentIndex === -1) {
          resolve({
            success: false,
            error: `Could not find component index for setting property`,
          })
          return
        }

        // 构建正确的属性路径
        const propertyPath = `__comps__.${rawComponentIndex}.${property}`

        // 特殊处理资源类属性
        if (propertyType === 'asset' || propertyType === 'spriteFrame' || propertyType === 'prefab'
          || (propertyInfo.type === 'asset' && propertyType === 'string')) {
          console.log(`[ComponentTools] Setting asset reference:`, {
            value: processedValue,
            property,
            propertyType,
            path: propertyPath,
          })

          // Determine asset type based on property name
          let assetType = 'cc.SpriteFrame' // default
          if (property.toLowerCase().includes('texture')) {
            assetType = 'cc.Texture2D'
          }
          else if (property.toLowerCase().includes('material')) {
            assetType = 'cc.Material'
          }
          else if (property.toLowerCase().includes('font')) {
            assetType = 'cc.Font'
          }
          else if (property.toLowerCase().includes('clip')) {
            assetType = 'cc.AudioClip'
          }
          else if (propertyType === 'prefab') {
            assetType = 'cc.Prefab'
          }

          await Editor.Message.request('scene', 'set-property', {
            uuid: nodeUuid,
            path: propertyPath,
            dump: {
              value: processedValue,
              type: assetType,
            },
          })
        }
        else if (componentType === 'cc.UITransform' && (property === '_contentSize' || property === 'contentSize')) {
          // Special handling for UITransform contentSize - set width and height separately
          const width = Number(value.width) || 100
          const height = Number(value.height) || 100

          // Set width first
          await Editor.Message.request('scene', 'set-property', {
            uuid: nodeUuid,
            path: `__comps__.${rawComponentIndex}.width`,
            dump: { value: width },
          })

          // Then set height
          await Editor.Message.request('scene', 'set-property', {
            uuid: nodeUuid,
            path: `__comps__.${rawComponentIndex}.height`,
            dump: { value: height },
          })
        }
        else if (componentType === 'cc.UITransform' && (property === '_anchorPoint' || property === 'anchorPoint')) {
          // Special handling for UITransform anchorPoint - set anchorX and anchorY separately
          const anchorX = Number(value.x) || 0.5
          const anchorY = Number(value.y) || 0.5

          // Set anchorX first
          await Editor.Message.request('scene', 'set-property', {
            uuid: nodeUuid,
            path: `__comps__.${rawComponentIndex}.anchorX`,
            dump: { value: anchorX },
          })

          // Then set anchorY
          await Editor.Message.request('scene', 'set-property', {
            uuid: nodeUuid,
            path: `__comps__.${rawComponentIndex}.anchorY`,
            dump: { value: anchorY },
          })
        }
        else if (propertyType === 'color' && processedValue && typeof processedValue === 'object') {
          // 特殊处理颜色属性，确保RGBA值正确
          // Cocos Creator颜色值范围是0-255
          const colorValue = {
            r: Math.min(255, Math.max(0, Number(processedValue.r) || 0)),
            g: Math.min(255, Math.max(0, Number(processedValue.g) || 0)),
            b: Math.min(255, Math.max(0, Number(processedValue.b) || 0)),
            a: processedValue.a !== undefined ? Math.min(255, Math.max(0, Number(processedValue.a))) : 255,
          }

          console.log(`[ComponentTools] Setting color value:`, colorValue)

          await Editor.Message.request('scene', 'set-property', {
            uuid: nodeUuid,
            path: propertyPath,
            dump: {
              value: colorValue,
              type: 'cc.Color',
            },
          })
        }
        else if (propertyType === 'vec3' && processedValue && typeof processedValue === 'object') {
          // 特殊处理Vec3属性
          const vec3Value = {
            x: Number(processedValue.x) || 0,
            y: Number(processedValue.y) || 0,
            z: Number(processedValue.z) || 0,
          }

          await Editor.Message.request('scene', 'set-property', {
            uuid: nodeUuid,
            path: propertyPath,
            dump: {
              value: vec3Value,
              type: 'cc.Vec3',
            },
          })
        }
        else if (propertyType === 'vec2' && processedValue && typeof processedValue === 'object') {
          // 特殊处理Vec2属性
          const vec2Value = {
            x: Number(processedValue.x) || 0,
            y: Number(processedValue.y) || 0,
          }

          await Editor.Message.request('scene', 'set-property', {
            uuid: nodeUuid,
            path: propertyPath,
            dump: {
              value: vec2Value,
              type: 'cc.Vec2',
            },
          })
        }
        else if (propertyType === 'size' && processedValue && typeof processedValue === 'object') {
          // 特殊处理Size属性
          const sizeValue = {
            width: Number(processedValue.width) || 0,
            height: Number(processedValue.height) || 0,
          }

          await Editor.Message.request('scene', 'set-property', {
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
          await Editor.Message.request('scene', 'set-property', {
            uuid: nodeUuid,
            path: propertyPath,
            dump: {
              value: processedValue,
              type: 'cc.Node',
            },
          })
        }
        else if (propertyType === 'component' && typeof processedValue === 'string') {
          // 特殊处理组件引用：通过节点UUID找到组件的__id__
          const targetNodeUuid = processedValue
          console.log(`[ComponentTools] Setting component reference - finding component on node: ${targetNodeUuid}`)

          // 从当前组件的属性元数据中获取期望的组件类型
          let expectedComponentType = ''

          // 获取当前组件的详细信息，包括属性元数据
          const currentComponentInfo = await this.getComponentInfo(nodeUuid, componentType)
          if (currentComponentInfo.success && currentComponentInfo.data?.properties?.[property]) {
            const propertyMeta = currentComponentInfo.data.properties[property]

            // 从属性元数据中提取组件类型信息
            if (propertyMeta && typeof propertyMeta === 'object') {
              // 检查是否有type字段指示组件类型
              if (propertyMeta.type) {
                expectedComponentType = propertyMeta.type
              }
              else if (propertyMeta.ctor) {
                // 有些属性可能使用ctor字段
                expectedComponentType = propertyMeta.ctor
              }
              else if (propertyMeta.extends && Array.isArray(propertyMeta.extends)) {
                // 检查extends数组，通常第一个是最具体的类型
                for (const extendType of propertyMeta.extends) {
                  if (extendType.startsWith('cc.') && extendType !== 'cc.Component' && extendType !== 'cc.Object') {
                    expectedComponentType = extendType
                    break
                  }
                }
              }
            }
          }

          if (!expectedComponentType) {
            throw new Error(`Unable to determine required component type for property '${property}' on component '${componentType}'. Property metadata may not contain type information.`)
          }

          console.log(`[ComponentTools] Detected required component type: ${expectedComponentType} for property: ${property}`)

          try {
            // 获取目标节点的组件信息
            const targetNodeData = await Editor.Message.request('scene', 'query-node', targetNodeUuid)
            if (!targetNodeData || !targetNodeData.__comps__) {
              throw new Error(`Target node ${targetNodeUuid} not found or has no components`)
            }

            // 打印目标节点的组件概览
            console.log(`[ComponentTools] Target node ${targetNodeUuid} has ${targetNodeData.__comps__.length} components:`)
            targetNodeData.__comps__.forEach((comp: any, index: number) => {
              const sceneId = comp.value && comp.value.uuid && comp.value.uuid.value ? comp.value.uuid.value : 'unknown'
              console.log(`[ComponentTools] Component ${index}: ${comp.type} (scene_id: ${sceneId})`)
            })

            // 查找对应的组件
            let targetComponent = null
            let componentId: string | null = null

            // 在目标节点的_components数组中查找指定类型的组件
            // 注意：__comps__和_components的索引是对应的
            console.log(`[ComponentTools] Searching for component type: ${expectedComponentType}`)

            for (let i = 0; i < targetNodeData.__comps__.length; i++) {
              const comp = targetNodeData.__comps__[i] as any
              console.log(`[ComponentTools] Checking component ${i}: type=${comp.type}, target=${expectedComponentType}`)

              if (comp.type === expectedComponentType) {
                targetComponent = comp
                console.log(`[ComponentTools] Found matching component at index ${i}: ${comp.type}`)

                // 从组件的value.uuid.value中获取组件在场景中的ID
                if (comp.value && comp.value.uuid && comp.value.uuid.value) {
                  componentId = comp.value.uuid.value
                  console.log(`[ComponentTools] Got componentId from comp.value.uuid.value: ${componentId}`)
                }
                else {
                  console.log(`[ComponentTools] Component structure:`, {
                    hasValue: !!comp.value,
                    hasUuid: !!(comp.value && comp.value.uuid),
                    hasUuidValue: !!(comp.value && comp.value.uuid && comp.value.uuid.value),
                    uuidStructure: comp.value ? comp.value.uuid : 'No value',
                  })
                  throw new Error(`Unable to extract component ID from component structure`)
                }

                break
              }
            }

            if (!targetComponent) {
              // 如果没找到，列出可用组件让用户了解，显示场景中的真实ID
              const availableComponents = targetNodeData.__comps__.map((comp: any, index: number) => {
                let sceneId = 'unknown'
                // 从组件的value.uuid.value获取场景ID
                if (comp.value && comp.value.uuid && comp.value.uuid.value) {
                  sceneId = comp.value.uuid.value
                }
                return `${comp.type}(scene_id:${sceneId})`
              })
              throw new Error(`Component type '${expectedComponentType}' not found on node ${targetNodeUuid}. Available components: ${availableComponents.join(', ')}`)
            }

            console.log(`[ComponentTools] Found component ${expectedComponentType} with scene ID: ${componentId} on node ${targetNodeUuid}`)

            // 更新期望值为实际的组件ID对象格式，用于后续验证
            if (componentId) {
              actualExpectedValue = { uuid: componentId }
            }

            // 尝试使用与节点/资源引用相同的格式：{uuid: componentId}
            // 测试看是否能正确设置组件引用
            await Editor.Message.request('scene', 'set-property', {
              uuid: nodeUuid,
              path: propertyPath,
              dump: {
                value: { uuid: componentId }, // 使用对象格式，像节点/资源引用一样
                type: expectedComponentType,
              },
            })
          }
          catch (error) {
            console.error(`[ComponentTools] Error setting component reference:`, error)
            throw error
          }
        }
        else if (propertyType === 'nodeArray' && Array.isArray(processedValue)) {
          // 特殊处理节点数组 - 保持预处理的格式
          console.log(`[ComponentTools] Setting node array:`, processedValue)

          await Editor.Message.request('scene', 'set-property', {
            uuid: nodeUuid,
            path: propertyPath,
            dump: {
              value: processedValue, // 保持 [{uuid: "..."}, {uuid: "..."}] 格式
            },
          })
        }
        else if (propertyType === 'colorArray' && Array.isArray(processedValue)) {
          // 特殊处理颜色数组
          const colorArrayValue = processedValue.map((item: any) => {
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

          await Editor.Message.request('scene', 'set-property', {
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
          await Editor.Message.request('scene', 'set-property', {
            uuid: nodeUuid,
            path: propertyPath,
            dump: { value: processedValue },
          })
        }

        // Step 5: 等待Editor完成更新，然后验证设置结果
        await new Promise(resolve => setTimeout(resolve, 200)) // 等待200ms让Editor完成更新

        const verification = await this.verifyPropertyChange(nodeUuid, componentType, property, originalValue, actualExpectedValue)

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
      catch (error: any) {
        console.error(`[ComponentTools] Error setting property:`, error)
        resolve({
          success: false,
          error: `Failed to set property: ${error.message}`,
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
        const existingScript = allComponentsInfo.data.components.find((comp: any) => this.matchScriptComponent(comp, scriptName))
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
      }).then(async (result: any) => {
        // 等待一段时间让Editor完成组件添加
        await new Promise(resolve => setTimeout(resolve, 100))
        // 重新查询节点信息验证脚本是否真的添加成功
        const allComponentsInfo2 = await this.getComponents(nodeUuid)
        if (allComponentsInfo2.success && allComponentsInfo2.data?.components) {
          // 改进验证逻辑：同时检查 type、name 和 cid 字段
          const addedScript = allComponentsInfo2.data.components.find((comp: any) => this.matchScriptComponent(comp, scriptName))
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
              error: `Script '${scriptName}' was not found on node after addition. Available components: ${allComponentsInfo2.data.components.map((c: any) => c.type).join(', ')}`,
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
        Editor.Message.request('scene', 'execute-scene-script', options).then((result: any) => {
          resolve(result)
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

  private isValidPropertyDescriptor(propData: any): boolean {
    // 检查是否是有效的属性描述对象
    if (typeof propData !== 'object' || propData === null) {
      return false
    }

    try {
      const keys = Object.keys(propData)

      // 避免遍历简单的数值对象（如 {width: 200, height: 150}）
      const isSimpleValueObject = keys.every((key) => {
        const value = propData[key]
        return typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean'
      })

      if (isSimpleValueObject) {
        return false
      }

      // 检查是否包含属性描述符的特征字段，不使用'in'操作符
      const hasName = keys.includes('name')
      const hasValue = keys.includes('value')
      const hasType = keys.includes('type')
      const hasDisplayName = keys.includes('displayName')
      const hasReadonly = keys.includes('readonly')

      // 必须包含name或value字段，且通常还有type字段
      const hasValidStructure = (hasName || hasValue) && (hasType || hasDisplayName || hasReadonly)

      // 额外检查：如果有default字段且结构复杂，避免深度遍历
      if (keys.includes('default') && propData.default && typeof propData.default === 'object') {
        const defaultKeys = Object.keys(propData.default)
        if (defaultKeys.includes('value') && typeof propData.default.value === 'object') {
          // 这种情况下，我们只返回顶层属性，不深入遍历default.value
          return hasValidStructure
        }
      }

      return hasValidStructure
    }
    catch (error) {
      console.warn(`[isValidPropertyDescriptor] Error checking property descriptor:`, error)
      return false
    }
  }

  private analyzeProperty(component: any, propertyName: string): { exists: boolean, type: string, availableProperties: string[], originalValue: any } {
    // 从复杂的组件结构中提取可用属性
    const availableProperties: string[] = []
    let propertyValue: any
    let propertyExists = false

    // query-node 返回的组件结构：{ cid, __type__, type, value: { ... }, uuid, enabled }
    // 提取真正的属性容器：优先使用 component.value，其次 component.properties
    const propertyContainer: any = (component && typeof component.value === 'object' && component.value !== null)
      ? component.value
      : (component && typeof component.properties === 'object' && component.properties !== null && !(Array.isArray(component.properties)))
          ? (component.properties.value && typeof component.properties.value === 'object' ? component.properties.value : component.properties)
          : component

    // 1. 直接属性访问
    if (Object.prototype.hasOwnProperty.call(component, propertyName)) {
      propertyValue = component[propertyName]
      propertyExists = true
    }

    // 2. 从嵌套结构中查找
    if (!propertyExists && propertyContainer && typeof propertyContainer === 'object') {
      for (const [key, propData] of Object.entries(propertyContainer)) {
        if (this.isValidPropertyDescriptor(propData)) {
          const propInfo = propData as any
          availableProperties.push(key)
          if (key === propertyName) {
            try {
              const propKeys = Object.keys(propInfo)
              propertyValue = propKeys.includes('value') ? propInfo.value : propInfo
            }
            catch (error) {
              propertyValue = propInfo
            }
            propertyExists = true
          }
        }
        // query-node 原始结构：value[key] 是值本身，name/displayName/type 是元数据
        else if (propertyContainer === component.value && key === propertyName) {
          propertyValue = propData
          propertyExists = true
        }
      }
    }

    // 3. 兜底：从直接属性中提取简单属性名（query-node value 结构常用）
    if (availableProperties.length === 0 && propertyContainer && typeof propertyContainer === 'object') {
      for (const key of Object.keys(propertyContainer)) {
        if (['__type__', 'cid', 'node', 'uuid', 'name', 'enabled', 'type', 'readonly', 'visible', 'editor', 'extends', '_enabled', '_name', '_objFlags'].includes(key)) {
          continue
        }
        if (key.startsWith('_')) {
          continue
        }
        availableProperties.push(key)
        if (!propertyExists && key === propertyName) {
          propertyValue = propertyContainer[key]
          propertyExists = true
        }
      }
    }

    if (!propertyExists) {
      return {
        exists: false,
        type: 'unknown',
        availableProperties,
        originalValue: undefined,
      }
    }

    let type = 'unknown'

    // 智能类型检测
    if (Array.isArray(propertyValue)) {
      // 数组类型检测
      if (propertyName.toLowerCase().includes('node')) {
        type = 'nodeArray'
      }
      else if (propertyName.toLowerCase().includes('color')) {
        type = 'colorArray'
      }
      else {
        type = 'array'
      }
    }
    else if (typeof propertyValue === 'string') {
      // Check if property name suggests it's an asset
      if (['spriteFrame', 'texture', 'material', 'font', 'clip', 'prefab'].includes(propertyName.toLowerCase())) {
        type = 'asset'
      }
      else {
        type = 'string'
      }
    }
    else if (typeof propertyValue === 'number') {
      type = 'number'
    }
    else if (typeof propertyValue === 'boolean') {
      type = 'boolean'
    }
    else if (propertyValue && typeof propertyValue === 'object') {
      try {
        const keys = Object.keys(propertyValue)
        if (keys.includes('r') && keys.includes('g') && keys.includes('b')) {
          type = 'color'
        }
        else if (keys.includes('x') && keys.includes('y')) {
          type = propertyValue.z !== undefined ? 'vec3' : 'vec2'
        }
        else if (keys.includes('width') && keys.includes('height')) {
          type = 'size'
        }
        else if (keys.includes('uuid') || keys.includes('__uuid__')) {
          // 检查是否是节点引用（通过属性名或__id__属性判断）
          if (propertyName.toLowerCase().includes('node')
            || propertyName.toLowerCase().includes('target')
            || keys.includes('__id__')) {
            type = 'node'
          }
          else {
            type = 'asset'
          }
        }
        else if (keys.includes('__id__')) {
          // 节点引用特征
          type = 'node'
        }
        else {
          type = 'object'
        }
      }
      catch (error) {
        console.warn(`[analyzeProperty] Error checking property type for: ${JSON.stringify(propertyValue)}`)
        type = 'object'
      }
    }
    else if (propertyValue === null || propertyValue === undefined) {
      // For null/undefined values, check property name to determine type
      if (['spriteFrame', 'texture', 'material', 'font', 'clip', 'prefab'].includes(propertyName.toLowerCase())) {
        type = 'asset'
      }
      else if (propertyName.toLowerCase().includes('node')
        || propertyName.toLowerCase().includes('target')) {
        type = 'node'
      }
      else if (propertyName.toLowerCase().includes('component')) {
        type = 'component'
      }
      else {
        type = 'unknown'
      }
    }

    return {
      exists: true,
      type,
      availableProperties,
      originalValue: propertyValue,
    }
  }

  private smartConvertValue(inputValue: any, propertyInfo: any): any {
    const { type, originalValue } = propertyInfo

    console.log(`[smartConvertValue] Converting ${JSON.stringify(inputValue)} to type: ${type}`)

    switch (type) {
      case 'string':
        return String(inputValue)

      case 'number':
        return Number(inputValue)

      case 'boolean':
        if (typeof inputValue === 'boolean')
          return inputValue
        if (typeof inputValue === 'string') {
          return inputValue.toLowerCase() === 'true' || inputValue === '1'
        }
        return Boolean(inputValue)

      case 'color':
        // 优化的颜色处理，支持多种输入格式
        if (typeof inputValue === 'string') {
          // 字符串格式：十六进制、颜色名称、rgb()/rgba()
          return this.parseColorString(inputValue)
        }
        else if (typeof inputValue === 'object' && inputValue !== null) {
          try {
            const inputKeys = Object.keys(inputValue)
            // 如果输入是颜色对象，验证并转换
            if (inputKeys.includes('r') || inputKeys.includes('g') || inputKeys.includes('b')) {
              return {
                r: Math.min(255, Math.max(0, Number(inputValue.r) || 0)),
                g: Math.min(255, Math.max(0, Number(inputValue.g) || 0)),
                b: Math.min(255, Math.max(0, Number(inputValue.b) || 0)),
                a: inputValue.a !== undefined ? Math.min(255, Math.max(0, Number(inputValue.a))) : 255,
              }
            }
          }
          catch (error) {
            console.warn(`[smartConvertValue] Invalid color object: ${JSON.stringify(inputValue)}`)
          }
        }
        // 如果有原值，保持原值结构并更新提供的值
        if (originalValue && typeof originalValue === 'object') {
          try {
            const inputKeys = typeof inputValue === 'object' && inputValue ? Object.keys(inputValue) : []
            return {
              r: inputKeys.includes('r') ? Math.min(255, Math.max(0, Number(inputValue.r))) : (originalValue.r || 255),
              g: inputKeys.includes('g') ? Math.min(255, Math.max(0, Number(inputValue.g))) : (originalValue.g || 255),
              b: inputKeys.includes('b') ? Math.min(255, Math.max(0, Number(inputValue.b))) : (originalValue.b || 255),
              a: inputKeys.includes('a') ? Math.min(255, Math.max(0, Number(inputValue.a))) : (originalValue.a || 255),
            }
          }
          catch (error) {
            console.warn(`[smartConvertValue] Error processing color with original value: ${error}`)
          }
        }
        // 默认返回白色
        console.warn(`[smartConvertValue] Using default white color for invalid input: ${JSON.stringify(inputValue)}`)
        return { r: 255, g: 255, b: 255, a: 255 }

      case 'vec2':
        if (typeof inputValue === 'object' && inputValue !== null) {
          return {
            x: Number(inputValue.x) || originalValue.x || 0,
            y: Number(inputValue.y) || originalValue.y || 0,
          }
        }
        return originalValue

      case 'vec3':
        if (typeof inputValue === 'object' && inputValue !== null) {
          return {
            x: Number(inputValue.x) || originalValue.x || 0,
            y: Number(inputValue.y) || originalValue.y || 0,
            z: Number(inputValue.z) || originalValue.z || 0,
          }
        }
        return originalValue

      case 'size':
        if (typeof inputValue === 'object' && inputValue !== null) {
          return {
            width: Number(inputValue.width) || originalValue.width || 100,
            height: Number(inputValue.height) || originalValue.height || 100,
          }
        }
        return originalValue

      case 'node':
        if (typeof inputValue === 'string') {
          // 节点引用需要特殊处理
          return inputValue
        }
        else if (typeof inputValue === 'object' && inputValue !== null) {
          // 如果已经是对象形式，返回UUID或完整对象
          return inputValue.uuid || inputValue
        }
        return originalValue

      case 'asset':
        if (typeof inputValue === 'string') {
          // 如果输入是字符串路径，转换为asset对象
          return { uuid: inputValue }
        }
        else if (typeof inputValue === 'object' && inputValue !== null) {
          return inputValue
        }
        return originalValue

      default:
        // 对于未知类型，尽量保持原有结构
        if (typeof inputValue === typeof originalValue) {
          return inputValue
        }
        return originalValue
    }
  }

  /**
   * 将入参的 propertyType 归一化为内部统一的小写 token。
   * - 大小写不敏感（Color/color/COLOR 都视为 color）
   * - 兼容常见别名：cc.Color/cc.Vec2/cc.Size/cc.ValueType/Number/String/Boolean/Enum/Json/Object
   * - 未传时基于 value 自动推断
   */
  private normalizePropertyType(rawType: string | undefined, value: any): string {
    if (rawType === undefined || rawType === null || rawType === '') {
      return this.inferTypeFromValue(value, '', null) ?? 'auto'
    }

    const lower = String(rawType).trim().toLowerCase()
    if (!lower || lower === 'auto') {
      return this.inferTypeFromValue(value, '', null) ?? 'auto'
    }

    const aliasMap: Record<string, string> = {
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
      'prefab': 'prefab',
      'asset': 'asset',
      'nodearray': 'nodeArray',
      'colorarray': 'colorArray',
      'numberarray': 'numberArray',
      'stringarray': 'stringArray',
    }

    if (aliasMap[lower]) {
      return aliasMap[lower]
    }

    // 兼容驼峰写法，例如 sprite_frame / spriteframe / colorArray 等
    const camel = lower.replace(/[_-]([a-z])/g, (_m, c) => c.toUpperCase())
    if (aliasMap[camel]) {
      return aliasMap[camel]
    }

    // 兜底：返回小写
    return lower
  }

  /**
   * 根据属性值和上下文（属性名、已分析信息）自动推断 propertyType。
   * 返回 null 表示无法识别。
   */
  private inferTypeFromValue(value: any, propertyName: string, propertyInfo: any | null): string | null {
    // 1. 如果 value 是字符串，尝试解析 hex 颜色
    if (typeof value === 'string') {
      if (/^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)) {
        return 'color'
      }
      if (propertyInfo && propertyInfo.type === 'node') {
        return 'node'
      }
      if (propertyInfo && propertyInfo.type === 'asset') {
        return 'asset'
      }
      return 'string'
    }

    // 2. 数值
    if (typeof value === 'number') {
      return 'number'
    }

    // 3. 布尔
    if (typeof value === 'boolean') {
      return 'boolean'
    }

    // 4. 数组
    if (Array.isArray(value)) {
      if (value.length === 0) {
        return 'stringArray'
      }
      const first = value[0]
      if (typeof first === 'number') {
        return 'numberArray'
      }
      if (typeof first === 'string') {
        // 可能是 nodeArray 或 stringArray，根据属性名判断
        if (propertyInfo && propertyInfo.type === 'nodeArray') {
          return 'nodeArray'
        }
        if (/node|target|child/i.test(propertyName)) {
          return 'nodeArray'
        }
        return 'stringArray'
      }
      if (first && typeof first === 'object') {
        if ('r' in first || 'g' in first || 'b' in first) {
          return 'colorArray'
        }
      }
      return 'stringArray'
    }

    // 5. 对象：按字段识别
    if (value && typeof value === 'object') {
      const keys = Object.keys(value)
      if (keys.includes('r') || keys.includes('g') || keys.includes('b')) {
        return 'color'
      }
      if (keys.includes('width') || keys.includes('height')) {
        return 'size'
      }
      if (keys.includes('x') && keys.includes('y') && keys.includes('z')) {
        return 'vec3'
      }
      if (keys.includes('x') && keys.includes('y')) {
        return 'vec2'
      }
      if (keys.includes('uuid') || keys.includes('__uuid__') || keys.includes('__id__')) {
        // 通过属性名/类型判断是 node 还是 asset
        if (propertyInfo && propertyInfo.type === 'node') {
          return 'node'
        }
        if (propertyInfo && propertyInfo.type === 'asset') {
          return 'asset'
        }
        if (/node|target|child/i.test(propertyName)) {
          return 'node'
        }
        return 'asset'
      }
    }

    return null
  }

  /**
   * 根据类型处理值，返回处理后的值（不包含 side-effects）。
   * 用于自动类型推导后重走一次分派。
   */
  private processTypedValue(value: any, type: string, _propertyName: string, _propertyInfo: any): any {
    switch (type) {
      case 'string':
        return String(value)
      case 'number':
      case 'integer':
      case 'float':
        return Number(value)
      case 'boolean':
        return Boolean(value)
      case 'enum':
        return value
      case 'object':
      case 'json':
        return (value && typeof value === 'object') ? value : value
      case 'color':
        if (typeof value === 'string') {
          return this.parseColorString(value)
        }
        return {
          r: Math.min(255, Math.max(0, Number((value as any).r) || 0)),
          g: Math.min(255, Math.max(0, Number((value as any).g) || 0)),
          b: Math.min(255, Math.max(0, Number((value as any).b) || 0)),
          a: (value as any).a !== undefined ? Math.min(255, Math.max(0, Number((value as any).a))) : 255,
        }
      case 'vec2':
        return { x: Number((value as any).x) || 0, y: Number((value as any).y) || 0 }
      case 'vec3':
        return { x: Number((value as any).x) || 0, y: Number((value as any).y) || 0, z: Number((value as any).z) || 0 }
      case 'size':
        return { width: Number((value as any).width) || 0, height: Number((value as any).height) || 0 }
      case 'node':
        return typeof value === 'string' ? { uuid: value } : value
      case 'asset':
      case 'spriteFrame':
      case 'prefab':
        return typeof value === 'string' ? { uuid: value } : value
      default:
        return value
    }
  }

  /**
   * 把任意可能的组件 name 字段归一化为字符串。
   * query-node 返回的 name 字段有时是字符串，有时是 { value: 'xxx' } 对象。
   */
  private normalizeComponentName(raw: any): string {
    if (typeof raw === 'string') {
      return raw
    }
    if (raw && typeof raw === 'object') {
      if (typeof raw.value === 'string') {
        return raw.value
      }
      if (raw.value && typeof raw.value === 'object' && typeof raw.value.value === 'string') {
        return raw.value.value
      }
    }
    return ''
  }

  /**
   * 判断组件 comp 是否是指定 scriptName 对应的脚本组件。
   * 兼容 comp.name 为字符串或 { value: '...' } 对象的情况。
   */
  private matchScriptComponent(comp: any, scriptName: string): boolean {
    const compType = this.normalizeComponentName(comp.type)
    const compName = this.normalizeComponentName(comp.name)
    const compCid = this.normalizeComponentName(comp.cid)
    console.log(compType, compName, compCid)
    // 注意：query-node 返回的组件 name 可能是 "NodeName<UITransform>" 这种
    // "节点名+<组件类>" 形式的字符串；不能用 .includes 匹配脚本名，
    // 否则会出现"假阳性已存在"——尤其是节点名和脚本类同名时。
    const compTypeUnderscore = this.normalizeComponentName(comp.__type__)
    if (compType === scriptName)
      return true
    if (compTypeUnderscore === scriptName)
      return true
    if (compName === scriptName)
      return true
    // 脚本组件 name 也可能带 "NodeName<ScriptName>" 后缀，仅匹配严格后缀
    if (compName.endsWith(`<${scriptName}>`))
      return true
    if (compCid && compCid !== 'cc.Script' && compCid === scriptName)
      return true
    return false
  }

  /**
   * 构造 propertyType 不支持时的友好错误信息。
   * 把支持的类型完整列出，并给出常见类型对应的 value 示例。
   */
  private buildUnsupportedPropertyTypeError(rawType: string, value: any): string {
    const supported: { type: string, aliases: string[], example: string }[] = [
      { type: 'color', aliases: ['Color', 'cc.Color', '#RRGGBB', '#RRGGBBAA'], example: '{ r: 255, g: 0, b: 0, a: 255 } or "#FF0000"' },
      { type: 'vec2', aliases: ['Vec2', 'cc.Vec2'], example: '{ x: 100, y: 200 }' },
      { type: 'vec3', aliases: ['Vec3', 'cc.Vec3'], example: '{ x: 1, y: 2, z: 3 }' },
      { type: 'size', aliases: ['Size', 'cc.Size'], example: '{ width: 100, height: 50 }' },
      { type: 'number', aliases: ['Number', 'int', 'integer', 'float', 'double'], example: '42' },
      { type: 'string', aliases: ['String', 'str'], example: '"hello"' },
      { type: 'boolean', aliases: ['Boolean', 'bool'], example: 'true' },
      { type: 'enum', aliases: ['Enum'], example: '0 or "ValueName"' },
      { type: 'object', aliases: ['Object', 'JSON', 'json', 'cc.ValueType'], example: '{ key: "value" }' },
      { type: 'node', aliases: ['Node', 'cc.Node'], example: 'target node uuid (string) or { uuid: "..." }' },
      { type: 'asset', aliases: ['Asset', 'spriteFrame', 'SpriteFrame', 'prefab', 'Prefab'], example: 'asset uuid (string) or { uuid: "..." }' },
      { type: 'colorArray', aliases: ['ColorArray'], example: '[{ r:255, g:0, b:0, a:255 }]' },
      { type: 'numberArray', aliases: ['NumberArray'], example: '[1, 2, 3]' },
      { type: 'stringArray', aliases: ['StringArray'], example: '["a", "b"]' },
      { type: 'nodeArray', aliases: ['NodeArray'], example: '["nodeUuid1", "nodeUuid2"]' },
    ]
    const list = supported.map(s => `  - ${s.type} (aliases: ${s.aliases.join('/')}) — example: ${s.example}`).join('\n')
    return `Unsupported property type: "${rawType}".\n`
      + `propertyType is case-insensitive. Supported types:\n${list}\n`
      + `Tip: if you omit propertyType, the value will be auto-detected from the JSON shape.\n`
      + `Received value: ${JSON.stringify(value)}`
  }

  private parseColorString(colorStr: string): { r: number, g: number, b: number, a: number } {
    const str = colorStr.trim()

    // 只支持十六进制格式 #RRGGBB 或 #RRGGBBAA
    if (str.startsWith('#')) {
      if (str.length === 7) { // #RRGGBB
        const r = Number.parseInt(str.substring(1, 3), 16)
        const g = Number.parseInt(str.substring(3, 5), 16)
        const b = Number.parseInt(str.substring(5, 7), 16)
        return { r, g, b, a: 255 }
      }
      else if (str.length === 9) { // #RRGGBBAA
        const r = Number.parseInt(str.substring(1, 3), 16)
        const g = Number.parseInt(str.substring(3, 5), 16)
        const b = Number.parseInt(str.substring(5, 7), 16)
        const a = Number.parseInt(str.substring(7, 9), 16)
        return { r, g, b, a }
      }
    }

    // 如果不是有效的十六进制格式，返回错误提示
    throw new Error(`Invalid color format: "${colorStr}". Only hexadecimal format is supported (e.g., "#FF0000" or "#FF0000FF")`)
  }

  private async verifyPropertyChange(nodeUuid: string, componentType: string, property: string, originalValue: any, expectedValue: any): Promise<{ verified: boolean, actualValue: any, fullData: any }> {
    console.log(`[verifyPropertyChange] Starting verification for ${componentType}.${property}`)
    console.log(`[verifyPropertyChange] Expected value:`, JSON.stringify(expectedValue))
    console.log(`[verifyPropertyChange] Original value:`, JSON.stringify(originalValue))

    try {
      // 重新获取组件信息进行验证
      console.log(`[verifyPropertyChange] Calling getComponentInfo...`)
      const componentInfo = await this.getComponentInfo(nodeUuid, componentType)
      console.log(`[verifyPropertyChange] getComponentInfo success:`, componentInfo.success)

      const allComponents = await this.getComponents(nodeUuid)
      console.log(`[verifyPropertyChange] getComponents success:`, allComponents.success)

      if (componentInfo.success && componentInfo.data) {
        console.log(`[verifyPropertyChange] Component data available, extracting property '${property}'`)
        const allPropertyNames = Object.keys(componentInfo.data.properties || {})
        console.log(`[verifyPropertyChange] Available properties:`, allPropertyNames)
        const propertyData = componentInfo.data.properties?.[property]
        console.log(`[verifyPropertyChange] Raw property data for '${property}':`, JSON.stringify(propertyData))

        // 从属性数据中提取实际值
        let actualValue = propertyData
        console.log(`[verifyPropertyChange] Initial actualValue:`, JSON.stringify(actualValue))

        if (propertyData && typeof propertyData === 'object' && 'value' in propertyData) {
          actualValue = propertyData.value
          console.log(`[verifyPropertyChange] Extracted actualValue from .value:`, JSON.stringify(actualValue))
        }
        else {
          console.log(`[verifyPropertyChange] No .value property found, using raw data`)
        }

        // 修复验证逻辑：检查实际值是否匹配期望值
        let verified = false

        if (typeof expectedValue === 'object' && expectedValue !== null && 'uuid' in expectedValue) {
          // 对于引用类型（节点/组件/资源），比较UUID
          const actualUuid = actualValue && typeof actualValue === 'object' && 'uuid' in actualValue ? actualValue.uuid : ''
          const expectedUuid = expectedValue.uuid || ''
          verified = actualUuid === expectedUuid && expectedUuid !== ''

          console.log(`[verifyPropertyChange] Reference comparison:`)
          console.log(`  - Expected UUID: "${expectedUuid}"`)
          console.log(`  - Actual UUID: "${actualUuid}"`)
          console.log(`  - UUID match: ${actualUuid === expectedUuid}`)
          console.log(`  - UUID not empty: ${expectedUuid !== ''}`)
          console.log(`  - Final verified: ${verified}`)
        }
        else {
          // 对于其他类型，直接比较值
          console.log(`[verifyPropertyChange] Value comparison:`)
          console.log(`  - Expected type: ${typeof expectedValue}`)
          console.log(`  - Actual type: ${typeof actualValue}`)

          if (typeof actualValue === typeof expectedValue) {
            if (typeof actualValue === 'object' && actualValue !== null && expectedValue !== null) {
              // 对象类型的深度比较
              verified = JSON.stringify(actualValue) === JSON.stringify(expectedValue)
              console.log(`  - Object comparison (JSON): ${verified}`)
            }
            else {
              // 基本类型的直接比较
              verified = actualValue === expectedValue
              console.log(`  - Direct comparison: ${verified}`)
            }
          }
          else {
            // 类型不匹配时的特殊处理（如数字和字符串）
            const stringMatch = String(actualValue) === String(expectedValue)
            const numberMatch = Number(actualValue) === Number(expectedValue)
            verified = stringMatch || numberMatch
            console.log(`  - String match: ${stringMatch}`)
            console.log(`  - Number match: ${numberMatch}`)
            console.log(`  - Type mismatch verified: ${verified}`)
          }
        }

        console.log(`[verifyPropertyChange] Final verification result: ${verified}`)
        console.log(`[verifyPropertyChange] Final actualValue:`, JSON.stringify(actualValue))

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

        console.log(`[verifyPropertyChange] Returning result:`, JSON.stringify(result, null, 2))
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
   * 检测是否为节点属性，如果是则重定向到对应的节点方法
   */
  private async checkAndRedirectNodeProperties(args: any): Promise<ToolResponse | null> {
    const { nodeUuid, componentType, property, propertyType, value } = args

    // 检测是否为节点基础属性（应该使用 set_node_property）
    const nodeBasicProperties = [
      'name',
      'active',
      'layer',
      'mobility',
      'parent',
      'children',
      'hideFlags',
    ]

    // 检测是否为节点变换属性（应该使用 set_node_transform）
    const nodeTransformProperties = [
      'position',
      'rotation',
      'scale',
      'eulerAngles',
      'angle',
    ]

    // Detect attempts to set cc.Node properties (common mistake)
    if (componentType === 'cc.Node' || componentType === 'Node') {
      if (nodeBasicProperties.includes(property)) {
        return {
          success: false,
          error: `Property '${property}' is a node basic property, not a component property`,
          instruction: `Please use set_node_property method to set node properties: set_node_property(uuid="${nodeUuid}", property="${property}", value=${JSON.stringify(value)})`,
        }
      }
      else if (nodeTransformProperties.includes(property)) {
        return {
          success: false,
          error: `Property '${property}' is a node transform property, not a component property`,
          instruction: `Please use set_node_transform method to set transform properties: set_node_transform(uuid="${nodeUuid}", ${property}=${JSON.stringify(value)})`,
        }
      }
    }

    // Detect common incorrect usage
    if (nodeBasicProperties.includes(property) || nodeTransformProperties.includes(property)) {
      const methodName = nodeTransformProperties.includes(property) ? 'set_node_transform' : 'set_node_property'
      return {
        success: false,
        error: `Property '${property}' is a node property, not a component property`,
        instruction: `Property '${property}' should be set using ${methodName} method, not set_component_property. Please use: ${methodName}(uuid="${nodeUuid}", ${nodeTransformProperties.includes(property) ? property : `property="${property}"`}=${JSON.stringify(value)})`,
      }
    }

    return null // 不是节点属性，继续正常处理
  }

  /**
   * 生成组件建议信息
   */
  private generateComponentSuggestion(requestedType: string, availableTypes: string[], property: string): string {
    // 检查是否存在相似的组件类型
    const similarTypes = availableTypes.filter(type =>
      type.toLowerCase().includes(requestedType.toLowerCase())
      || requestedType.toLowerCase().includes(type.toLowerCase()),
    )

    let instruction = ''

    if (similarTypes.length > 0) {
      instruction += `\n\n🔍 Found similar components: ${similarTypes.join(', ')}`
      instruction += `\n💡 Suggestion: Perhaps you meant to set the '${similarTypes[0]}' component?`
    }

    // Recommend possible components based on property name
    const propertyToComponentMap: Record<string, string[]> = {
      string: ['cc.Label', 'cc.RichText', 'cc.EditBox'],
      text: ['cc.Label', 'cc.RichText'],
      fontSize: ['cc.Label', 'cc.RichText'],
      spriteFrame: ['cc.Sprite'],
      color: ['cc.Label', 'cc.Sprite', 'cc.Graphics'],
      normalColor: ['cc.Button'],
      pressedColor: ['cc.Button'],
      target: ['cc.Button'],
      contentSize: ['cc.UITransform'],
      anchorPoint: ['cc.UITransform'],
    }

    const recommendedComponents = propertyToComponentMap[property] || []
    const availableRecommended = recommendedComponents.filter(comp => availableTypes.includes(comp))

    if (availableRecommended.length > 0) {
      instruction += `\n\n🎯 Based on property '${property}', recommended components: ${availableRecommended.join(', ')}`
    }

    // Provide operation suggestions
    instruction += `\n\n📋 Suggested Actions:`
    instruction += `\n1. Use get_components(nodeUuid="${requestedType.includes('uuid') ? 'YOUR_NODE_UUID' : 'nodeUuid'}") to view all components on the node`
    instruction += `\n2. If you need to add a component, use add_component(nodeUuid="...", componentType="${requestedType}")`
    instruction += `\n3. Verify that the component type name is correct (case-sensitive)`

    return instruction
  }

  /**
   * 快速验证资源设置结果
   */
  private async quickVerifyAsset(nodeUuid: string, componentType: string, property: string): Promise<any> {
    try {
      const rawNodeData = await Editor.Message.request('scene', 'query-node', nodeUuid)
      if (!rawNodeData || !rawNodeData.__comps__) {
        return null
      }

      // 找到组件
      const component = rawNodeData.__comps__.find((comp: any) => {
        const compType = comp.__type__ || comp.cid || comp.type
        return compType === componentType
      })

      if (!component) {
        return null
      }

      // 提取属性值
      const properties = this.extractComponentProperties(component)
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
