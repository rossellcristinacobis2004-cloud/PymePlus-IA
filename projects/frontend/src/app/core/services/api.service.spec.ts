import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { ApiService } from './api.service';
import { TokenService } from './token.service';
import { apiInterceptor } from '../interceptors/api.interceptor';
import { ApiEnvelope } from '../models/api.model';

describe('ApiService', () => {
  let httpMock: HttpTestingController;
  let api: ApiService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([apiInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    api = TestBed.inject(ApiService);
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  it('desenvuelve el sobre y envía JWT, requestId y versión', () => {
    TestBed.inject(TokenService).setTokens('access-token', 'refresh-token');

    let received = 0;
    api.get<number[]>('/products').subscribe((data) => (received = data.length));

    const request = httpMock.expectOne('/api/products');
    expect(request.request.headers.get('Authorization')).toBe('Bearer access-token');
    expect(request.request.headers.get('Accept-Version')).toBe('1');
    expect(request.request.headers.get('X-Request-Id')).toMatch(/^[0-9a-f-]{36}$/i);

    const envelope: ApiEnvelope<number[]> = {
      success: true,
      message: 'OK',
      data: [1, 2, 3],
      meta: { requestId: null, timestamp: '', timezone: 'America/Caracas' },
      errors: [],
    };
    request.flush(envelope);
    expect(received).toBe(3);
  });

  it('convierte un error del sobre en ApiError con mensaje legible', () => {
    let userMessage = '';
    let code = '';
    api.post('/sales', {}).subscribe({
      error: (error: unknown) => {
        const apiError = error as { userMessage: string; code: string };
        userMessage = apiError.userMessage;
        code = apiError.code;
      },
    });

    const request = httpMock.expectOne('/api/sales');
    request.flush(
      {
        success: false,
        message: 'No se pudo registrar la venta.',
        userMessage: 'No hay suficiente stock de Aceite. Quedan 3 unidades.',
        data: null,
        meta: { requestId: 'req_1', timestamp: '', timezone: 'America/Caracas' },
        errors: [
          {
            code: 'INSUFFICIENT_STOCK',
            field: 'items[0].quantity',
            detail: 'Solicitadas 5 unidades; disponibles 3.',
            suggestion: 'Ajusta la cantidad.',
            retryable: false,
          },
        ],
      },
      { status: 409, statusText: 'Conflict' },
    );

    expect(code).toBe('INSUFFICIENT_STOCK');
    expect(userMessage).toContain('No hay suficiente stock');
  });
});
