import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { ApiEnvelope } from '../models/api.model';
import { ApiError } from '../errors/api-error';

export interface ApiRequestOptions {
  headers?: HttpHeaders | Record<string, string>;
  params?: HttpParams | Record<string, string | number | boolean>;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api';

  get<T>(path: string, options?: ApiRequestOptions): Observable<T> {
    return this.http
      .get<ApiEnvelope<T>>(this.url(path), options)
      .pipe(map((envelope) => this.unwrap(envelope)));
  }

  post<T>(path: string, body: unknown, options?: ApiRequestOptions): Observable<T> {
    return this.http
      .post<ApiEnvelope<T>>(this.url(path), body, options)
      .pipe(map((envelope) => this.unwrap(envelope)));
  }

  patch<T>(path: string, body: unknown, options?: ApiRequestOptions): Observable<T> {
    return this.http
      .patch<ApiEnvelope<T>>(this.url(path), body, options)
      .pipe(map((envelope) => this.unwrap(envelope)));
  }

  delete<T>(path: string, options?: ApiRequestOptions): Observable<T> {
    return this.http
      .delete<ApiEnvelope<T>>(this.url(path), options)
      .pipe(map((envelope) => this.unwrap(envelope)));
  }

  /** Las facturas se descargan con JWT; nunca se sirven como archivos estáticos. */
  download(path: string): Observable<Blob> {
    return this.http.get(this.url(path), { responseType: 'blob' });
  }

  private url(path: string): string {
    return `${this.base}${path.startsWith('/') ? path : `/${path}`}`;
  }

  private unwrap<T>(envelope: ApiEnvelope<T>): T {
    if (!envelope?.success) {
      const issue = envelope?.errors?.[0];
      throw new ApiError(
        200,
        issue?.code || 'API_ERROR',
        envelope?.message || 'La operación no se pudo completar.',
        envelope?.userMessage || envelope?.message || 'No se pudo completar la operación.',
        issue?.suggestion || null,
        envelope?.meta?.requestId || null,
        issue?.field || null,
      );
    }
    return envelope.data;
  }
}
