import { Injectable, computed, signal } from '@angular/core';

import { LoginData, User } from '../models/user.model';

const ACCESS_KEY = 'pymeplus.accessToken';
const REFRESH_KEY = 'pymeplus.refreshToken';
const USER_KEY = 'pymeplus.user';

function readUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

@Injectable({ providedIn: 'root' })
export class TokenService {
  private readonly accessTokenSignal = signal<string | null>(localStorage.getItem(ACCESS_KEY));
  private readonly refreshTokenSignal = signal<string | null>(localStorage.getItem(REFRESH_KEY));
  private readonly userSignal = signal<User | null>(readUser());

  readonly user = this.userSignal.asReadonly();
  readonly isAuthenticated = computed(() => Boolean(this.accessTokenSignal()));

  accessToken(): string | null {
    return this.accessTokenSignal();
  }

  refreshToken(): string | null {
    return this.refreshTokenSignal();
  }

  setSession(data: LoginData): void {
    this.setTokens(data.token, data.refreshToken);
    localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    this.userSignal.set(data.user);
  }

  setTokens(accessToken: string, refreshToken: string): void {
    localStorage.setItem(ACCESS_KEY, accessToken);
    localStorage.setItem(REFRESH_KEY, refreshToken);
    this.accessTokenSignal.set(accessToken);
    this.refreshTokenSignal.set(refreshToken);
  }

  clear(): void {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(USER_KEY);
    this.accessTokenSignal.set(null);
    this.refreshTokenSignal.set(null);
    this.userSignal.set(null);
  }
}
