import { Routes } from '@angular/router';

import { authGuard } from './core/guards/auth.guard';
import { posGuard } from './core/guards/pos.guard';
import { LoginComponent } from './features/auth/login.component';
import { PosComponent } from './features/pos/pos.component';
import { ShellComponent } from './shared/layout/shell.component';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'pos' },
  { path: 'login', component: LoginComponent },
  {
    path: '',
    component: ShellComponent,
    canActivate: [authGuard],
    children: [
      { path: 'pos', component: PosComponent, canActivate: [posGuard] },
    ],
  },
  { path: '**', redirectTo: 'pos' },
];
