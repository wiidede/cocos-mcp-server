import type { ToolFailureMetadata, ToolResponse } from '../types'

export interface ToolResponseOptions {
  data?: unknown
  message?: string
  instruction?: string
  warning?: string
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
    ...options,
  }
}
