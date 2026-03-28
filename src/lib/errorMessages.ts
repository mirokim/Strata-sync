/**
 * errorMessages.ts — LLM 프로바이더 에러 코드 → 사용자 친화적 한국어 메시지 변환
 *
 * 4개 provider(Anthropic, OpenAI, Gemini, Grok)와 agentLoop에서 공유합니다.
 */

export type ProviderName = 'Anthropic' | 'OpenAI' | 'Gemini' | 'Grok' | 'API'

/**
 * HTTP 상태 코드와 원문 에러 본문을 받아 사용자 친화적 메시지를 반환합니다.
 */
export function toUserFriendlyError(status: number, provider: ProviderName = 'API'): string {
  switch (status) {
    case 401:
      return `[인증 오류] ${provider} API 키가 올바르지 않습니다. 설정 → AI 설정에서 API 키를 확인하세요.`
    case 403:
      return `[권한 오류] ${provider} API 접근이 거부됐습니다. API 키 권한을 확인하세요.`
    case 429:
      return `[한도 초과] ${provider} 요청 한도를 초과했습니다. 잠시 후 다시 시도하세요.`
    case 500:
      return `[서버 오류] ${provider} 서버에 일시적인 오류가 발생했습니다. 잠시 후 다시 시도하세요.`
    case 503:
      return `[서비스 불가] ${provider} 서비스가 일시적으로 중단됐습니다. 잠시 후 다시 시도하세요.`
    default:
      if (status >= 400 && status < 500) {
        return `[요청 오류 ${status}] ${provider} 요청이 거부됐습니다. 설정을 확인하세요.`
      }
      if (status >= 500) {
        return `[서버 오류 ${status}] ${provider} 서버 오류가 발생했습니다.`
      }
      return `[오류 ${status}] ${provider} 응답 오류가 발생했습니다.`
  }
}

/**
 * fetch 실패(네트워크) 에러를 사용자 친화적 메시지로 변환합니다.
 */
export function toNetworkError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('fetch failed')) {
    return '[네트워크 오류] 인터넷 연결을 확인하세요.'
  }
  if (msg.includes('AbortError') || msg.includes('aborted')) {
    return '[중단됨] 요청이 취소됐습니다.'
  }
  if (msg.includes('timeout') || msg.includes('Timeout')) {
    return '[시간 초과] 응답 시간이 초과됐습니다. 다시 시도하세요.'
  }
  // 이미 변환된 사용자 친화적 메시지는 그대로 반환
  if (msg.startsWith('[')) return msg
  return `[오류] ${msg}`
}
