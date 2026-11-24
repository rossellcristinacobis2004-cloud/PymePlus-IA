import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { TokenService } from '../services/token.service';
import { ToastService } from '../services/toast.service';

/** La gestión de usuarios es exclusiva de ADMIN; el alias histórico también cuenta. */
export const adminGuard: CanActivateFn = () => {
  const tokens = inject(TokenService);
  const router = inject(Router);
  const toasts = inject(ToastService);
  const role = tokens.user()?.role;

  if (role === 'ADMIN' || role === 'Administrador') return true;

  toasts.warning('Tu perfil no tiene acceso a usuarios.', 'Solicita permiso a un administrador.');
  return router.createUrlTree(['/pos']);
};
