import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { LoginComponent } from './login.component';

describe('LoginComponent', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  it('vincula los campos al FormGroup sin errores de renderizado', async () => {
    const fixture = TestBed.createComponent(LoginComponent);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector<HTMLInputElement>('#email')?.value).toBe('admin@pymeplus.local');
    expect(element.querySelector<HTMLInputElement>('#password')?.value).toBe('');
    expect(fixture.componentInstance.form.invalid).toBe(true);
  });

  it('no revela credenciales ni rutas de archivos en pantalla', async () => {
    const fixture = TestBed.createComponent(LoginComponent);
    await fixture.whenStable();
    const text = (fixture.nativeElement as HTMLElement).textContent || '';

    expect(text.toLowerCase()).not.toContain('credenciales');
    expect(text).not.toContain('.env');
    expect(text).toContain('Ingresar al sistema');
  });

  it('muestra una guía cuando la contraseña es demasiado corta', async () => {
    const fixture = TestBed.createComponent(LoginComponent);
    fixture.componentInstance.form.controls.password.setValue('abc');
    fixture.componentInstance.form.markAllAsTouched();
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('al menos 6 caracteres');
    expect(fixture.componentInstance.submitting()).toBe(false);
  });
});
