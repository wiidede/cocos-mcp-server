import type { ToolConfig, ToolConfiguration, ToolManagerSettings } from '../types'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { v4 as uuidv4 } from 'uuid'
import { AssetAdvancedTools } from './asset-advanced-tools'
import { BroadcastTools } from './broadcast-tools'
import { ComponentTools } from './component-tools'
import { DebugTools } from './debug-tools'
import { NodeTools } from './node-tools'
import { PrefabTools } from './prefab-tools'
import { PreferencesTools } from './preferences-tools'
import { ProjectTools } from './project-tools'
import { ReferenceImageTools } from './reference-image-tools'
import { SceneAdvancedTools } from './scene-advanced-tools'
// 导入所有工具类
import { SceneTools } from './scene-tools'
import { SceneViewTools } from './scene-view-tools'
import { ServerTools } from './server-tools'
import { ValidationTools } from './validation-tools'

export class ToolManager {
  private settings: ToolManagerSettings
  private availableTools: ToolConfig[] = []

  constructor() {
    this.settings = this.readToolManagerSettings()
    this.initializeAvailableTools()

    // 如果没有配置，自动创建一个默认配置
    if (this.settings.configurations.length === 0) {
      console.log('[ToolManager] No configurations found, creating default configuration...')
      this.createConfiguration('默认配置', '自动创建的默认工具配置')
    }
    else {
      // 验证并修复现有配置
      this.validateAndFixConfigurations()
    }
  }

  private getToolManagerSettingsPath(): string {
    return path.join(Editor.Project.path, 'settings', 'tool-manager.json')
  }

  private ensureSettingsDir(): void {
    const settingsDir = path.dirname(this.getToolManagerSettingsPath())
    if (!fs.existsSync(settingsDir)) {
      fs.mkdirSync(settingsDir, { recursive: true })
    }
  }

  private readToolManagerSettings(): ToolManagerSettings {
    const DEFAULT_TOOL_MANAGER_SETTINGS: ToolManagerSettings = {
      configurations: [],
      currentConfigId: '',
      maxConfigSlots: 5,
    }

    try {
      this.ensureSettingsDir()
      const settingsFile = this.getToolManagerSettingsPath()
      if (fs.existsSync(settingsFile)) {
        const content = fs.readFileSync(settingsFile, 'utf8')
        return { ...DEFAULT_TOOL_MANAGER_SETTINGS, ...JSON.parse(content) }
      }
    }
    catch (e) {
      console.error('Failed to read tool manager settings:', e)
    }
    return DEFAULT_TOOL_MANAGER_SETTINGS
  }

  private saveToolManagerSettings(settings: ToolManagerSettings): void {
    try {
      this.ensureSettingsDir()
      const settingsFile = this.getToolManagerSettingsPath()
      fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2))
    }
    catch (e) {
      console.error('Failed to save tool manager settings:', e)
      throw e
    }
  }

  private exportToolConfiguration(config: ToolConfiguration): string {
    return JSON.stringify(config, null, 2)
  }

  private importToolConfiguration(configJson: string): ToolConfiguration {
    try {
      const config = JSON.parse(configJson)
      // 验证配置格式
      if (!config.id || !config.name || !Array.isArray(config.tools)) {
        throw new Error('Invalid configuration format')
      }
      return config
    }
    catch (e) {
      console.error('Failed to parse tool configuration:', e)
      throw new Error('Invalid JSON format or configuration structure')
    }
  }

  private initializeAvailableTools(): void {
    // 从MCP服务器获取真实的工具列表
    try {
      // 初始化工具实例
      const tools = {
        scene: new SceneTools(),
        node: new NodeTools(),
        component: new ComponentTools(),
        prefab: new PrefabTools(),
        project: new ProjectTools(),
        debug: new DebugTools(),
        preferences: new PreferencesTools(),
        server: new ServerTools(),
        broadcast: new BroadcastTools(),
        sceneAdvanced: new SceneAdvancedTools(),
        sceneView: new SceneViewTools(),
        referenceImage: new ReferenceImageTools(),
        assetAdvanced: new AssetAdvancedTools(),
        validation: new ValidationTools(),
      }

      // 从每个工具类获取工具列表
      this.availableTools = []
      for (const [category, toolSet] of Object.entries(tools)) {
        const toolDefinitions = toolSet.getTools()
        toolDefinitions.forEach((tool: any) => {
          this.availableTools.push({
            category,
            name: tool.name,
            enabled: true, // 默认启用
            description: tool.description,
          })
        })
      }

      console.log(`[ToolManager] Initialized ${this.availableTools.length} tools from MCP server`)
    }
    catch (error) {
      console.error('[ToolManager] Failed to initialize tools from MCP server:', error)
      // 如果获取失败，使用默认工具列表作为后备
      this.initializeDefaultTools()
    }
  }

  private initializeDefaultTools(): void {
    // 默认工具列表作为后备方案 - 使用与实际工具类相同的名称
    try {
      // 初始化工具实例（和 initializeAvailableTools 相同的逻辑）
      const tools = {
        scene: new SceneTools(),
        node: new NodeTools(),
        component: new ComponentTools(),
        prefab: new PrefabTools(),
        project: new ProjectTools(),
        debug: new DebugTools(),
        preferences: new PreferencesTools(),
        server: new ServerTools(),
        broadcast: new BroadcastTools(),
        sceneAdvanced: new SceneAdvancedTools(),
        sceneView: new SceneViewTools(),
        referenceImage: new ReferenceImageTools(),
        assetAdvanced: new AssetAdvancedTools(),
        validation: new ValidationTools(),
      }

      // 从每个工具类获取工具列表
      this.availableTools = []
      for (const [category, toolSet] of Object.entries(tools)) {
        const toolDefinitions = toolSet.getTools()
        toolDefinitions.forEach((tool: any) => {
          this.availableTools.push({
            category,
            name: tool.name,
            enabled: true, // 默认启用
            description: tool.description,
          })
        })
      }

      console.log(`[ToolManager] Initialized ${this.availableTools.length} tools from default fallback`)
    }
    catch (error) {
      console.error('[ToolManager] Failed to initialize tools from default fallback:', error)
      // 如果连这个也失败了，使用空列表
      this.availableTools = []
    }
  }

  public getAvailableTools(): ToolConfig[] {
    return [...this.availableTools]
  }

  public getConfigurations(): ToolConfiguration[] {
    return [...this.settings.configurations]
  }

  public getCurrentConfiguration(): ToolConfiguration | null {
    if (!this.settings.currentConfigId) {
      return null
    }
    return this.settings.configurations.find(config => config.id === this.settings.currentConfigId) || null
  }

  public createConfiguration(name: string, description?: string): ToolConfiguration {
    if (this.settings.configurations.length >= this.settings.maxConfigSlots) {
      throw new Error(`已达到最大配置槽位数量 (${this.settings.maxConfigSlots})`)
    }

    const config: ToolConfiguration = {
      id: uuidv4(),
      name,
      description,
      tools: this.availableTools.map(tool => ({ ...tool })),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    this.settings.configurations.push(config)
    this.settings.currentConfigId = config.id
    this.saveSettings()

    return config
  }

  public updateConfiguration(configId: string, updates: Partial<ToolConfiguration>): ToolConfiguration {
    const configIndex = this.settings.configurations.findIndex(config => config.id === configId)
    if (configIndex === -1) {
      throw new Error('配置不存在')
    }

    const config = this.settings.configurations[configIndex]
    const updatedConfig: ToolConfiguration = {
      ...config,
      ...updates,
      updatedAt: new Date().toISOString(),
    }

    this.settings.configurations[configIndex] = updatedConfig
    this.saveSettings()

    return updatedConfig
  }

  public deleteConfiguration(configId: string): void {
    const configIndex = this.settings.configurations.findIndex(config => config.id === configId)
    if (configIndex === -1) {
      throw new Error('配置不存在')
    }

    this.settings.configurations.splice(configIndex, 1)

    // 如果删除的是当前配置，清空当前配置ID
    if (this.settings.currentConfigId === configId) {
      this.settings.currentConfigId = this.settings.configurations.length > 0
        ? this.settings.configurations[0].id
        : ''
    }

    this.saveSettings()
  }

  public setCurrentConfiguration(configId: string): void {
    const config = this.settings.configurations.find(config => config.id === configId)
    if (!config) {
      throw new Error('配置不存在')
    }

    this.settings.currentConfigId = configId
    this.saveSettings()
  }

  public updateToolStatus(configId: string, category: string, toolName: string, enabled: boolean): void {
    console.log(`Backend: Updating tool status - configId: ${configId}, category: ${category}, toolName: ${toolName}, enabled: ${enabled}`)

    const config = this.settings.configurations.find(config => config.id === configId)
    if (!config) {
      console.error(`Backend: Config not found with ID: ${configId}`)
      throw new Error('配置不存在')
    }

    console.log(`Backend: Found config: ${config.name}`)

    const tool = config.tools.find(t => t.category === category && t.name === toolName)
    if (!tool) {
      console.error(`Backend: Tool not found - category: ${category}, name: ${toolName}`)
      throw new Error('工具不存在')
    }

    console.log(`Backend: Found tool: ${tool.name}, current enabled: ${tool.enabled}, new enabled: ${enabled}`)

    tool.enabled = enabled
    config.updatedAt = new Date().toISOString()

    console.log(`Backend: Tool updated, saving settings...`)
    this.saveSettings()
    console.log(`Backend: Settings saved successfully`)
  }

  public updateToolStatusBatch(configId: string, updates: { category: string, name: string, enabled: boolean }[]): void {
    console.log(`Backend: updateToolStatusBatch called with configId: ${configId}`)
    console.log(`Backend: Current configurations count: ${this.settings.configurations.length}`)
    console.log(`Backend: Current config IDs:`, this.settings.configurations.map(c => c.id))

    const config = this.settings.configurations.find(config => config.id === configId)
    if (!config) {
      console.error(`Backend: Config not found with ID: ${configId}`)
      console.error(`Backend: Available config IDs:`, this.settings.configurations.map(c => c.id))
      throw new Error('配置不存在')
    }

    console.log(`Backend: Found config: ${config.name}, updating ${updates.length} tools`)

    updates.forEach((update) => {
      const tool = config.tools.find(t => t.category === update.category && t.name === update.name)
      if (tool) {
        tool.enabled = update.enabled
      }
    })

    config.updatedAt = new Date().toISOString()
    this.saveSettings()
    console.log(`Backend: Batch update completed successfully`)
  }

  public exportConfiguration(configId: string): string {
    const config = this.settings.configurations.find(config => config.id === configId)
    if (!config) {
      throw new Error('配置不存在')
    }

    return this.exportToolConfiguration(config)
  }

  public importConfiguration(configJson: string): ToolConfiguration {
    const config = this.importToolConfiguration(configJson)

    // 生成新的ID和时间戳
    config.id = uuidv4()
    config.createdAt = new Date().toISOString()
    config.updatedAt = new Date().toISOString()

    if (this.settings.configurations.length >= this.settings.maxConfigSlots) {
      throw new Error(`已达到最大配置槽位数量 (${this.settings.maxConfigSlots})`)
    }

    this.settings.configurations.push(config)
    this.saveSettings()

    return config
  }

  public getEnabledTools(): ToolConfig[] {
    const currentConfig = this.getCurrentConfiguration()
    if (!currentConfig) {
      return this.availableTools.filter(tool => tool.enabled)
    }
    return currentConfig.tools.filter(tool => tool.enabled)
  }

  public getToolManagerState() {
    const currentConfig = this.getCurrentConfiguration()
    return {
      success: true,
      availableTools: currentConfig ? currentConfig.tools : this.getAvailableTools(),
      selectedConfigId: this.settings.currentConfigId,
      configurations: this.getConfigurations(),
      maxConfigSlots: this.settings.maxConfigSlots,
    }
  }

  private saveSettings(): void {
    console.log(`Backend: Saving settings, current configs count: ${this.settings.configurations.length}`)
    this.saveToolManagerSettings(this.settings)
    console.log(`Backend: Settings saved to file`)
  }

  /**
   * 验证并修复配置中的工具名称
   * 如果配置中的工具名称和实际工具类中的名称不匹配，则重新生成配置
   */
  private validateAndFixConfigurations(): void {
    const availableToolMap = new Map<string, ToolConfig>()
    this.availableTools.forEach((tool) => {
      availableToolMap.set(`${tool.category}_${tool.name}`, tool)
    })

    let needsSave = false

    for (const config of this.settings.configurations) {
      const invalidTools: string[] = []

      for (const tool of config.tools) {
        const key = `${tool.category}_${tool.name}`
        if (!availableToolMap.has(key)) {
          invalidTools.push(key)
        }
      }

      if (invalidTools.length > 0) {
        console.warn(`[ToolManager] Configuration "${config.name}" has ${invalidTools.length} invalid tools, regenerating...`)
        console.warn(`[ToolManager] Invalid tools:`, invalidTools)

        // 重新生成工具列表，保留启用状态
        const enabledToolKeys = new Set(config.tools.filter(t => t.enabled).map(t => `${t.category}_${t.name}`))

        config.tools = this.availableTools.map((tool) => {
          const key = `${tool.category}_${tool.name}`
          // 如果旧配置中有这个工具且是启用的，则保持启用
          // 注意：这里使用模糊匹配，因为工具名称可能已经改变
          const wasEnabled = enabledToolKeys.has(key) || config.tools.some(
            t => t.category === tool.category && t.enabled,
          )
          return {
            ...tool,
            enabled: wasEnabled,
          }
        })

        config.updatedAt = new Date().toISOString()
        needsSave = true
      }
    }

    if (needsSave) {
      this.saveSettings()
      console.log('[ToolManager] Configurations validated and fixed')
    }
  }
}
