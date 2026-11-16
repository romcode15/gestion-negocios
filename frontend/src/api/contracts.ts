export interface RequestOptions { signal?: AbortSignal }
export interface ListOptions extends RequestOptions { page?: number }
export type Method = 'GET' | 'POST' | 'PATCH'
export interface ApiRequest extends RequestOptions { method: Method; path: string; body?: unknown }
export interface Transport { request<T>(request: ApiRequest): Promise<T> }
