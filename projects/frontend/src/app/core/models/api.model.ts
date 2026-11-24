export interface ApiIssue {
  code: string;
  field: string | null;
  detail: string;
  suggestion: string | null;
  retryable: boolean;
}

export interface ApiPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
}

export interface ApiMeta {
  requestId: string | null;
  timestamp: string;
  timezone: string;
  pagination?: ApiPagination;
}

export interface ApiEnvelope<T> {
  success: boolean;
  message: string;
  userMessage?: string;
  data: T;
  meta: ApiMeta;
  errors: ApiIssue[];
}
