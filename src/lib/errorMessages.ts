/**
 * errorMessages.ts — LLM provider error code → user-friendly message conversion
 *
 * Shared across 4 providers (Anthropic, OpenAI, Gemini, Grok) and agentLoop.
 */

export type ProviderName = 'Anthropic' | 'OpenAI' | 'Gemini' | 'Grok' | 'API'

/**
 * Takes an HTTP status code and returns a user-friendly error message.
 */
export function toUserFriendlyError(status: number, provider: ProviderName = 'API'): string {
  switch (status) {
    case 401:
      return `[Auth Error] ${provider} API key is invalid. Please check your API key in Settings → AI Settings.`
    case 403:
      return `[Permission Error] ${provider} API access was denied. Please check your API key permissions.`
    case 429:
      return `[Rate Limit] ${provider} request limit exceeded. Please try again later.`
    case 500:
      return `[Server Error] ${provider} server encountered a temporary error. Please try again later.`
    case 503:
      return `[Service Unavailable] ${provider} service is temporarily unavailable. Please try again later.`
    default:
      if (status >= 400 && status < 500) {
        return `[Request Error ${status}] ${provider} request was rejected. Please check your settings.`
      }
      if (status >= 500) {
        return `[Server Error ${status}] ${provider} server error occurred.`
      }
      return `[Error ${status}] ${provider} response error occurred.`
  }
}

/**
 * Converts fetch failure (network) errors to user-friendly messages.
 */
export function toNetworkError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('fetch failed')) {
    return '[Network Error] Please check your internet connection.'
  }
  if (msg.includes('AbortError') || msg.includes('aborted')) {
    return '[Cancelled] The request was cancelled.'
  }
  if (msg.includes('timeout') || msg.includes('Timeout')) {
    return '[Timeout] Response timed out. Please try again.'
  }
  // Already-converted user-friendly messages are returned as-is
  if (msg.startsWith('[')) return msg
  return `[Error] ${msg}`
}
