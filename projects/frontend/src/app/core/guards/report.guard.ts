import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { TokenService } from '../services/token.service';
import { ToastService } from '../services/toast.service';

const REPORT_ROLES = ['ADMIN', 'Administrador', 'SUPERVISOR', 'FINANCE'];

/** Los reportes financieros no están disponibles para CASHIER ni WAREHOUSE. */
export const reportGuard: CanActivateFn = () => {
  const tokens = inject(TokenService);
  const router = inject(Router);
  const toasts = inject(ToastService);
  const role = tokens.user()?.role;

  if (role && REPORT_ROLES.includes(role)) return true;

  toasts.warning('Tu perfil no tiene acceso a reportes.', 'Solicita acceso a un supervisor.');
  return router.createUrlTree(['/pos']);
};
