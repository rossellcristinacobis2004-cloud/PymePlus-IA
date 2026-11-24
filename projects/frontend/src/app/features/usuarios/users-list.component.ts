import { Component, computed, inject, signal } from '@angular/core';

import { toApiError } from '../../core/errors/api-error';
import { Role } from '../../core/models/user.model';
import { ToastService } from '../../core/services/toast.service';
import { TokenService } from '../../core/services/token.service';
import {
  CreateUserPayload,
  ManagedUser,
  UsersService,
} from '../../core/services/users.service';

export const MANAGEABLE_ROLES: ReadonlyArray<Exclude<Role, 'Administrador'>> = [
  'ADMIN',
  'SUPERVISOR',
  'CASHIER',
  'WAREHOUSE',
  'FINANCE',
];

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Administrador',
  SUPERVISOR: 'Supervisor',
  CASHIER: 'Cajero',
  WAREHOUSE: 'Almacén',
  FINANCE: 'Finanzas',
  Administrador: 'Administrador',
};

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

export function isValidUserEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}

export function formatUserDate(value: string | null): string {
  if (!value) return 'Nunca';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-VE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Caracas',
  }).format(date);
}

@Component({
  selector: 'app-users-list',
  standalone: true,
  templateUrl: './users-list.component.html',
  styleUrl: './users-list.component.scss',
})
export class UsersListComponent {
  private readonly usersService = inject(UsersService);
  private readonly tokens = inject(TokenService);
  private readonly toasts = inject(ToastService);

  readonly roleOptions = MANAGEABLE_ROLES;
  readonly roleLabel = roleLabel;
  readonly formatUserDate = formatUserDate;

  readonly users = signal<ManagedUser[]>([]);
  readonly search = signal('');
  readonly loading = signal(true);
  readonly saving = signal(false);

  readonly name = signal('');
  readonly email = signal('');
  readonly password = signal('');
  readonly role = signal<Exclude<Role, 'Administrador'>>('CASHIER');

  readonly filteredUsers = computed(() => {
    const term = this.search().trim().toLowerCase();
    if (!term) return this.users();
    return this.users().filter(
      (user) =>
        user.name.toLowerCase().includes(term) ||
        user.email.toLowerCase().includes(term) ||
        roleLabel(user.role).toLowerCase().includes(term),
    );
  });

  constructor() {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.usersService.list().subscribe({
      next: (users) => this.users.set(users),
      error: (error: unknown) => {
        const apiError = toApiError(error);
        this.toasts.error(apiError.userMessage, apiError.suggestion);
        this.loading.set(false);
      },
      complete: () => this.loading.set(false),
    });
  }

  onSearch(value: string): void {
    this.search.set(value);
  }

  isSelf(user: ManagedUser): boolean {
    return user.id === this.tokens.user()?.id;
  }

  createUser(): void {
    const name = this.name().trim();
    const email = this.email().trim().toLowerCase();
    const password = this.password();
    const role = this.role();

    if (name.length < 2) {
      this.toasts.error('Ingresa el nombre del usuario.', 'Debe tener al menos 2 caracteres.');
      return;
    }
    if (!isValidUserEmail(email)) {
      this.toasts.error('Ingresa un correo válido.', 'Ejemplo: nombre@empresa.com.');
      return;
    }
    if (password.length < 8) {
      this.toasts.error('La contraseña debe tener al menos 8 caracteres.');
      return;
    }
    if (!MANAGEABLE_ROLES.includes(role)) {
      this.toasts.error('Selecciona un rol válido.');
      return;
    }

    const payload: CreateUserPayload = { name, email, password, role };
    this.saving.set(true);
    this.usersService.create(payload).subscribe({
      next: (created) => {
        this.users.update((items) => [created, ...items]);
        this.name.set('');
        this.email.set('');
        this.password.set('');
        this.role.set('CASHIER');
        this.toasts.success(`Usuario ${created.name} creado correctamente.`);
      },
      error: (error: unknown) => {
        const apiError = toApiError(error);
        this.toasts.error(apiError.userMessage, apiError.suggestion);
      },
      complete: () => this.saving.set(false),
    });
  }

  changeRole(user: ManagedUser, value: string): void {
    const role = value.trim().toUpperCase() as Exclude<Role, 'Administrador'>;
    if (!MANAGEABLE_ROLES.includes(role) || role === user.role) return;

    this.usersService.update(user.id, { role }).subscribe({
      next: (updated) => {
        this.users.update((items) => items.map((item) => (item.id === updated.id ? updated : item)));
        this.toasts.success(`Rol de ${updated.name} actualizado a ${roleLabel(updated.role)}.`);
      },
      error: (error: unknown) => {
        const apiError = toApiError(error);
        this.toasts.error(apiError.userMessage, apiError.suggestion);
        this.load();
      },
    });
  }

  toggleActive(user: ManagedUser): void {
    if (this.isSelf(user)) return;
    const active = !user.active;
    const action = active ? 'reactivar' : 'dar de baja';
    if (!active && !window.confirm(`¿Deseas dar de baja a ${user.name}?`)) return;

    const request = active
      ? this.usersService.update(user.id, { active: true })
      : this.usersService.deactivate(user.id);

    request.subscribe({
      next: (updated) => {
        this.users.update((items) => items.map((item) => (item.id === updated.id ? updated : item)));
        this.toasts.success(`Usuario ${updated.name} dado ${active ? 'de alta' : 'de baja'}.`);
      },
      error: (error: unknown) => {
        const apiError = toApiError(error);
        this.toasts.error(apiError.userMessage, apiError.suggestion);
        this.load();
      },
    });
  }
}
