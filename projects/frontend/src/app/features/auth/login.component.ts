import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';

import { AuthService } from '../../core/services/auth.service';
import { toApiError } from '../../core/errors/api-error';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly submitting = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly form = new FormGroup({
    email: new FormControl('admin@pymeplus.local', {
      nonNullable: true,
      validators: [Validators.required, Validators.email],
    }),
    password: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(6)],
    }),
  });

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.errorMessage.set(null);
    const { email, password } = this.form.getRawValue();

    this.auth.login(email, password).subscribe({
      next: () => void this.router.navigate(['/pos']),
      error: (error: unknown) => {
        const apiError = toApiError(error);
        const suggestion = apiError.suggestion ? ` ${apiError.suggestion}` : '';
        this.errorMessage.set(`${apiError.userMessage}${suggestion}`);
        this.submitting.set(false);
      },
    });
  }
}
