import { ProxyAgent, type Dispatcher } from 'undici'
import { trimOrUndefined } from './providerUtils.js'

export type LlmProxyConfig = {
  proxyUrl?: string
}

export type ResolvedLlmProxyConfig = {
  proxyUrl?: string
  source: 'provider_config' | 'env' | 'none'
}

type FetchInitWithDispatcher = RequestInit & {
  dispatcher?: Dispatcher
}

function getEnvProxyUrl(env: NodeJS.ProcessEnv): string | undefined {
  return (
    trimOrUndefined(env.https_proxy) ??
    trimOrUndefined(env.HTTPS_PROXY) ??
    trimOrUndefined(env.http_proxy) ??
    trimOrUndefined(env.HTTP_PROXY)
  )
}

export function resolveLlmProxyConfig(
  config: LlmProxyConfig | undefined,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedLlmProxyConfig {
  const providerProxyUrl = trimOrUndefined(config?.proxyUrl)

  if (providerProxyUrl) {
    return {
      proxyUrl: providerProxyUrl,
      source: 'provider_config',
    }
  }

  const envProxyUrl = getEnvProxyUrl(env)
  if (envProxyUrl) {
    return {
      proxyUrl: envProxyUrl,
      source: 'env',
    }
  }

  return {
    source: 'none',
  }
}

export function createProxyFetch(
  config: LlmProxyConfig | undefined,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): typeof fetch {
  const resolved = resolveLlmProxyConfig(config, env)
  if (!resolved.proxyUrl) {
    return fetchImpl
  }

  const dispatcher = new ProxyAgent(resolved.proxyUrl)

  return ((input, init) =>
    fetchImpl(input, {
      ...init,
      dispatcher,
    } as FetchInitWithDispatcher)) as typeof fetch
}
