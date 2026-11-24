import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('crea el componente raíz con el outlet y los avisos', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;

    expect(fixture.componentInstance).toBeTruthy();
    expect(element.querySelector('router-outlet')).not.toBeNull();
    expect(element.querySelector('app-toast-container')).not.toBeNull();
  });
});
