import { CanActivateFn, Router } from '@angular/router';
import { inject } from '@angular/core';

import { TokenService } from '../services/token.service';

const POS_ROLES = ['ADMIN', 'Administrador', 'SUPERVISOR', 'CASHIER'];

export const posGuard: CanActivateFn = () => {
  const tokens = inject(TokenService);
  const router = inject(Router);
  const role = tokens.user()?.role;

  return role && POS_ROLES.includes(role) ? true : router.createUrlTree(['/login']);
};
