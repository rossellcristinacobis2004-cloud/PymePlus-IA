export type Role = 'ADMIN' | 'SUPERVISOR' | 'FINANCE' | 'CASHIER' | 'WAREHOUSE' | 'Administrador';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
}

export interface LoginData {
  token: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: string;
  user: User;
}
