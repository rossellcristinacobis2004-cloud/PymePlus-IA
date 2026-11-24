import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, map, tap } from 'rxjs';

import { ApiService } from './api.service';
import { SocketService } from './socket.service';
import { TokenService } from './token.service';
import { LoginData, User } from '../models/user.model';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(ApiService);
  private readonly tokens = inject(TokenService);
  private readonly socket = inject(SocketService);
  private readonly router = inject(Router);

  login(email: string, password: string): Observable<User> {
    return this.api.post<LoginData>('/auth/login', { email, password }).pipe(
      tap((data) => {
        this.tokens.setSession(data);
        this.socket.connect();
      }),
      map((data) => data.user),
    );
  }

  logout(): void {
    this.socket.disconnect();
    this.tokens.clear();
    void this.router.navigate(['/login']);
  }
}
