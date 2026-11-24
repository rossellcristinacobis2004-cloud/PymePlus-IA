import { DOCUMENT } from '@angular/common';
import { Component, effect, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { AuthService } from '../../core/services/auth.service';
import { TokenService } from '../../core/services/token.service';

type Theme = 'light' | 'dark';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './shell.component.html',
  styleUrl: './shell.component.scss',
})
export class ShellComponent {
  private readonly auth = inject(AuthService);
  private readonly tokens = inject(TokenService);
  private readonly document = inject(DOCUMENT);

  readonly user = this.tokens.user;
  readonly theme = signal<Theme>(this.readTheme());

  private readonly applyTheme = effect(() => {
    const theme = this.theme();
    this.document.documentElement.setAttribute('data-bs-theme', theme);
    localStorage.setItem('pymeplus.theme', theme);
  });

  toggleTheme(): void {
    this.theme.update((current) => (current === 'light' ? 'dark' : 'light'));
  }

  logout(): void {
    this.auth.logout();
  }

  private readTheme(): Theme {
    return localStorage.getItem('pymeplus.theme') === 'dark' ? 'dark' : 'light';
  }
}
