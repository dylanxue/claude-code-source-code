import type { PermissionMode } from '../types/tool.js'
import {
  loadDclawConfigFiles,
} from './configFile.js'

export type PermissionModeSource = 'cli' | 'user' | 'workspace' | 'default'

export type ResolvedPermissionMode = {
  permissionMode: PermissionMode
  permissionModeSource: PermissionModeSource
}

const ALL_PERMISSION_MODES: PermissionMode[] = [
  'default',
  'accept-edits',
  'bypass-permissions',
  'plan',
]

function isPermissionMode(value: unknown): value is PermissionMode {
  return (
    value === 'default' ||
    value === 'accept-edits' ||
    value === 'bypass-permissions' ||
    value === 'plan'
  )
}

async function resolveConfiguredPermissionMode(
  config: Record<string, unknown> | undefined,
  path: string,
  _source: 'user' | 'workspace',
): Promise<PermissionMode | undefined> {
  if (!config || config.permissionMode === undefined) {
    return undefined
  }

  if (!isPermissionMode(config.permissionMode)) {
    throw new Error(
      `Invalid dclaw config at ${path}: permissionMode must be one of ${ALL_PERMISSION_MODES.join(', ')}`,
    )
  }

  return config.permissionMode
}

export async function resolvePermissionMode(
  options: {
    cwd: string
    permissionMode?: PermissionMode
  },
  env: NodeJS.ProcessEnv = process.env,
): Promise<ResolvedPermissionMode> {
  if (options.permissionMode) {
    return {
      permissionMode: options.permissionMode,
      permissionModeSource: 'cli',
    }
  }

  const {
    userConfig,
    workspaceConfig,
    userConfigPath,
    workspaceConfigPath,
  } = await loadDclawConfigFiles(options.cwd, env)
  const userPermissionMode = await resolveConfiguredPermissionMode(
    userConfig,
    userConfigPath,
    'user',
  )
  if (userPermissionMode) {
    return {
      permissionMode: userPermissionMode,
      permissionModeSource: 'user',
    }
  }

  const workspacePermissionMode = await resolveConfiguredPermissionMode(
    workspaceConfig,
    workspaceConfigPath,
    'workspace',
  )
  if (workspacePermissionMode) {
    return {
      permissionMode: workspacePermissionMode,
      permissionModeSource: 'workspace',
    }
  }

  return {
    permissionMode: 'default',
    permissionModeSource: 'default',
  }
}
