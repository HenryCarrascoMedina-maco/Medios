import { Injector, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Observable, Subject, of, throwError } from 'rxjs';
import { IPage } from '../models/api.models';
import { ToastService } from '../services/toast.service';
import { createPagedLoader } from './paged-loader';

describe('createPagedLoader', () => {
  let toast: { error: jest.Mock };

  beforeEach(() => {
    toast = { error: jest.fn() };
    TestBed.configureTestingModule({ providers: [{ provide: ToastService, useValue: toast }] });
  });

  afterEach(() => TestBed.resetTestingModule());

  const make = (fetch: (offset: number, take: number) => Observable<IPage<number>>) =>
    runInInjectionContext(TestBed.inject(Injector), () => createPagedLoader(fetch, { take: 2 }));

  const pages = (all: number[]) => (offset: number, take: number) => of({ items: all.slice(offset, offset + take), total: all.length });

  it('acumula páginas y sabe cuándo no hay más', () => {
    const loader = make(pages([1, 2, 3, 4, 5]));
    loader.reload();
    expect(loader.value()).toEqual([1, 2]);
    expect(loader.hasMore()).toBe(true);
    loader.loadMore();
    loader.loadMore();
    expect(loader.value()).toEqual([1, 2, 3, 4, 5]);
    expect(loader.hasMore()).toBe(false);
    loader.loadMore();
    expect(loader.value()).toEqual([1, 2, 3, 4, 5]);
  });

  it('no pide otra página mientras carga una', () => {
    const fetch = jest.fn((_offset: number) => new Subject<IPage<number>>());
    const loader = make(fetch);
    loader.reload();
    loader.loadMore();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('recargar cancela una página siguiente en curso y empieza de cero', () => {
    const more = new Subject<IPage<number>>();
    let call = 0;
    const loader = make(offset => (offset === 0 ? of({ items: [call++ ? 9 : 1, 2], total: 4 }) : more));
    loader.reload();
    loader.loadMore();
    loader.reload();
    more.next({ items: [3, 4], total: 4 });
    expect(loader.value()).toEqual([9, 2]);
    expect(more.observed).toBe(false);
  });

  it('si falla una página siguiente conserva lo cargado y avisa', () => {
    const loader = make(offset => (offset === 0 ? of({ items: [1, 2], total: 4 }) : throwError(() => new Error('x'))));
    loader.reload();
    loader.loadMore();
    expect(loader.value()).toEqual([1, 2]);
    expect(loader.status()).toBe('error');
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it('reset vacía y vuelve a cargar', () => {
    const loader = make(pages([1, 2, 3]));
    loader.reload();
    loader.loadMore();
    loader.reset();
    expect(loader.value()).toEqual([1, 2]);
    expect(loader.total()).toBe(3);
  });
});
