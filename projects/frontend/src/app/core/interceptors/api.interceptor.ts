import { HttpClient, HttpContextToken, HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, switchMap, throwError } from 'rxjs';

import { toApiError } from '../errors/api-error';
import { ApiEnvelope } from '../models/api.model';
import { LoginData } from '../models/user.model';
import { TokenService } from '../services/token.service';

/** Evita volver a intentar el refresh si la segunda petición también falla. */
export const REFRESH_RETRIED = new HttpContextToken<boolean>(() => false);

const PUBLIC_AUTH_PATHS = ['/auth/login', '/auth/refresh', '/auth/forgot-password', '/auth/reset-password'];

function isAuthRequest(url: string): boolean {
  return PUBLIC_AUTH_PATHS.some((path) => url.includes(path));
}

export const apiInterceptor: HttpInterceptorFn = (request, next) => {
  const tokens = inject(TokenService);
  const router = inject(Router);
  const http = inject(HttpClient);

  const access = tokens.accessToken();
  const headers: Record<string, string> = {
    'X-Request-Id': crypto.randomUUID(),
    'Accept-Version': '1',
  };
  if (access && !isAuthRequest(request.url)) {
    headers['Authorization'] = `Bearer ${access}`;
  }

  const outgoing = request.clone({ setHeaders: headers });

  return next(outgoing).pipe(
    catchError((error: unknown) => {
      const httpError = error as HttpErrorResponse;
      if (httpError.status !== 401 || isAuthRequest(outgoing.url) || outgoing.context.get(REFRESH_RETRIED)) {
        return throwError(() => toApiError(error));
      }

      const refreshToken = tokens.refreshToken();
      if (!refreshToken) {
        tokens.clear();
        void router.navigate(['/login']);
        return throwError(() => toApiError(error));
      }

      return http
        .post<ApiEnvelope<LoginData>>('/api/auth/refresh', { refreshToken })
        .pipe(
          switchMap((envelope) => {
            if (!envelope?.success) throw new Error('Refresh rechazado');
            tokens.setTokens(envelope.data.token, envelope.data.refreshToken);
            const retried = outgoing.clone({
              setHeaders: { Authorization: `Bearer ${envelope.data.token}` },
              context: outgoing.context.set(REFRESH_RETRIED, true),
            });
            return next(retried);
          }),
          catchError(() => {
            tokens.clear();
            void router.navigate(['/login']);
            return throwError(() => toApiError(error));
          }),
        );
    }),
  );
};
