import type { ToolErrorCode, ToolFailureCategory, ToolFailureMetadata, ToolResponse } from '../types'

export interface ToolResponseOptions {
  data?: unknown
  message?: string
  instruction?: string
  warning?: string
  errorCode?: ToolErrorCode
  metadata?: ToolFailureMetadata
  verificationData?: unknown
  updatedProperties?: string[]
}

export function toolSuccess(data?: unknown, options: ToolResponseOptions = {}): ToolResponse {
  return {
    success: true,
    ...(data === undefined ? {} : { data }),
    ...options,
  }
}

export function toolFailure(error: string, options: ToolResponseOptions = {}): ToolResponse {
  return {
    success: false,
    error,
    errorCode: options.errorCode ?? errorCodeForCategory(options.metadata?.category),
    ...options,
  }
}

export function errorCodeForCategory(category?: ToolFailureCategory): ToolErrorCode {
  switch (category) {
    case 'contract':
      return 'TOOL_CONTRACT_ERROR'
    case 'target':
      return 'TOOL_TARGET_ERROR'
    case 'component':
      return 'TOOL_COMPONENT_ERROR'
    case 'asset':
      return 'TOOL_ASSET_ERROR'
    case 'ipc':
      return 'TOOL_IPC_ERROR'
    case 'runtime':
      return 'TOOL_RUNTIME_ERROR'
    default:
      return 'TOOL_EXECUTION_ERROR'
  }
}
