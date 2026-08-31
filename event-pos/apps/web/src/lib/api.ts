/**
 * Centralizzazione URL API.
 * Usa window.location.hostname per funzionare sia su localhost che in rete locale.
 */
export const getApiBase = (): string => {
  if (typeof window === 'undefined') return 'http://127.0.0.1:3001';
  return `http://${window.location.hostname}:3001`;
};

export const getApiUrl = (): string => `${getApiBase()}/api`;

/**
 * Wrapper fetch con gestione errori unificata.
 * Lancia un Error con il messaggio JSON dell'API se la risposta non è ok.
 */
export async function apiFetch<T = any>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const url = `${getApiUrl()}${path}`;
  const headers: Record<string, string> = { ...(options?.headers as Record<string, string> || {}) };
  if (options?.body) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, {
    ...options,
    headers,
  });

  if (!res.ok) {
    let errMsg = `HTTP ${res.status}`;
    try {
      const errData = await res.json();
      errMsg = errData?.error || errMsg;
    } catch {}
    throw new Error(errMsg);
  }

  // Gestisci risposte 204 No Content
  const contentType = res.headers.get('content-type') || '';
  if (res.status === 204 || !contentType.includes('application/json')) {
    return undefined as unknown as T;
  }

  return res.json();
}
