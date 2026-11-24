import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { Role } from '../models/user.model';
import { ApiService } from './api.service';

export interface ManagedUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface CreateUserPayload {
  name: string;
  email: string;
  password: string;
  role: Exclude<Role, 'Administrador'>;
}

export interface UpdateUserPayload {
  name?: string;
  email?: string;
  role?: Exclude<Role, 'Administrador'>;
  active?: boolean;
  password?: string;
}

@Injectable({ providedIn: 'root' })
export class UsersService {
  private readonly api = inject(ApiService);

  list(): Observable<ManagedUser[]> {
    return this.api.get<ManagedUser[]>('/users?limit=100');
  }

  create(payload: CreateUserPayload): Observable<ManagedUser> {
    return this.api.post<ManagedUser>('/users', payload);
  }

  update(id: string, payload: UpdateUserPayload): Observable<ManagedUser> {
    return this.api.patch<ManagedUser>(`/users/${encodeURIComponent(id)}`, payload);
  }

  deactivate(id: string): Observable<ManagedUser> {
    return this.api.delete<ManagedUser>(`/users/${encodeURIComponent(id)}`);
  }
}
