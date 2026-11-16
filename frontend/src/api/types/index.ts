export interface ApiError { code: string; detail: string; errors: Record<string, string[]> }
export interface Pagina<T> { count: number; next: string | null; previous: string | null; results: T[] }
