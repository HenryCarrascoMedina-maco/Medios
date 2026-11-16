import { Injector, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Observable, Subject, of, throwError } from 'rxjs';
import { ToastService } from '../services/toast.service';
import { createLoader } from './loader';

describe('createLoader', () => {
  let toast: { error: jest.Mock };

  beforeEach(() => {
    toast = { error: jest.fn() };
    TestBed.configureTestingModule({ providers: [{ provide: ToastService, useValue: toast }] });
  });

  afterEach(() => TestBed.resetTestingModule());

  const make = <T>(source: () => Observable<T>) => runInInjectionContext(TestBed.inject(Injector), () => createLoader(source, { errorMessage: 'Falló' }));

  it('cancela la petición anterior al recargar (la respuesta vieja no pisa la nueva)', () => {
    const responses = [new Subject<string>(), new Subject<string>()];
    let call = 0;
    const loader = make(() => responses[call++]);

    loader.reload();
    loader.reload();
    responses[1].next('nueva');
    responses[0].next('vieja');

    expect(loader.value()).toBe('nueva');
    expect(responses[0].observed).toBe(false);
  });

  it('sin datos, un fallo queda como estado de error (sin toast)', () => {
    const loader = make(() => throwError(() => new Error('x')));
    loader.reload();
    expect(loader.status()).toBe('error');
    expect(loader.error()).toBe('Falló');
    expect(loader.empty()).toBe(true);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('con datos, avisa una sola vez aunque falle varias veces seguidas', () => {
    let fail = false;
    const loader = make(() => (fail ? throwError(() => new Error('x')) : of([1])));
    loader.reload();
    fail = true;
    loader.reload();
    loader.reload();
    loader.reload();
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(loader.value()).toEqual([1]);

    fail = false;
    loader.reload();
    fail = true;
    loader.reload();
    expect(toast.error).toHaveBeenCalledTimes(2);
  });

  it('reset olvida el valor y vuelve a cargar', () => {
    let n = 0;
    const loader = make(() => of(++n));
    loader.reload();
    expect(loader.value()).toBe(1);
    loader.reset();
    expect(loader.value()).toBe(2);
    expect(loader.status()).toBe('ready');
  });
});
