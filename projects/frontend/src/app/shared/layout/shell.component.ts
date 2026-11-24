import { DOCUMENT } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { AuthService } from '../../core/services/auth.service';
import { TokenService } from '../../core/services/token.service';
import { RateWidgetComponent } from './rate-widget.component';

type Theme = 'light' | 'dark';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, RateWidgetComponent],
  templateUrl: './shell.component.html',
  styleUrl: './shell.component.scss',
})
export class ShellComponent {
  private readonly auth = inject(AuthService);
  private readonly tokens = inject(TokenService);
  private readonly document = inject(DOCUMENT);

  readonly user = this.tokens.user;
  readonly theme = signal<Theme>(this.readTheme());
  readonly sidebarOpen = signal(false);
  readonly canViewReports = computed(() => {
    const role = this.user()?.role;
    return role === 'ADMIN' || role === 'Administrador' || role === 'SUPERVISOR' || role === 'FINANCE';
  });

  private readonly applyTheme = effect(() => {
    const theme = this.theme();
    this.document.documentElement.setAttribute('data-bs-theme', theme);
    localStorage.setItem('pymeplus.theme', theme);
  });

  toggleTheme(): void {
    this.theme.update((current) => (current === 'light' ? 'dark' : 'light'));
  }

  toggleSidebar(): void {
    this.sidebarOpen.update((open) => !open);
  }

  closeSidebar(): void {
    this.sidebarOpen.set(false);
  }

  logout(): void {
    this.auth.logout();
  }

  private readTheme(): Theme {
    return localStorage.getItem('pymeplus.theme') === 'dark' ? 'dark' : 'light';
  }
}
