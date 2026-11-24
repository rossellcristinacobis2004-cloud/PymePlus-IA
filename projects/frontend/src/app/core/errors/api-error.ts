import { HttpErrorResponse } from '@angular/common/http';

import { ApiEnvelope, ApiIssue } from '../models/api.model';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly userMessage: string,
    readonly suggestion: string | null,
    readonly requestId: string | null,
    readonly field: string | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function firstIssue(envelope: ApiEnvelope<unknown> | null | undefined): ApiIssue | undefined {
  return envelope?.errors?.find((issue) => Boolean(issue)) ?? undefined;
}

/** Convierte cualquier fallo HTTP en un error con mensaje accionable para el cajero. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;

  if (error instanceof HttpErrorResponse) {
    const envelope = error.error as ApiEnvelope<unknown> | null;
    const issue = firstIssue(envelope);

    return new ApiError(
      error.status,
      issue?.code || envelope?.errors?.[0]?.code || 'REQUEST_FAILED',
      envelope?.message || error.message || 'La solicitud no pudo completarse.',
      envelope?.userMessage ||
        issue?.suggestion ||
        'No pudimos completar la operación. Inténtalo de nuevo.',
      issue?.suggestion || null,
      envelope?.meta?.requestId || error.headers?.get('X-Request-Id') || null,
      issue?.field || null,
    );
  }

  return new ApiError(
    0,
    'UNEXPECTED_ERROR',
    error instanceof Error ? error.message : String(error),
    'Ocurrió un problema inesperado. Inténtalo de nuevo.',
    'Si continúa, recarga la aplicación.',
    null,
  );
}
