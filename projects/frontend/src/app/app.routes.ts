import { Routes } from '@angular/router';

import { adminGuard } from './core/guards/admin.guard';
import { authGuard } from './core/guards/auth.guard';
import { posGuard } from './core/guards/pos.guard';
import { reportGuard } from './core/guards/report.guard';
import { InventoryListComponent } from './features/inventario/inventory-list.component';
import { LoginComponent } from './features/auth/login.component';
import { PosComponent } from './features/pos/pos.component';
import { ReportsComponent } from './features/reportes/reports.component';
import { SalesListComponent } from './features/ventas/sales-list.component';
import { UsersListComponent } from './features/usuarios/users-list.component';
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
      { path: 'inventario', component: InventoryListComponent },
      { path: 'ventas', component: SalesListComponent, canActivate: [posGuard] },
      { path: 'reportes', component: ReportsComponent, canActivate: [reportGuard] },
      { path: 'usuarios', component: UsersListComponent, canActivate: [adminGuard] },
    ],
  },
  { path: '**', redirectTo: 'pos' },
];
