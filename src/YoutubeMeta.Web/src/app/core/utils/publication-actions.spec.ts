import { PublicationStatus } from '../models/api.models';
import { mapSettled } from './concurrency';
import { canCancel, canResolve, canRetry, canReupload } from './publication-actions';

const ALL: PublicationStatus[] = ['PENDING', 'UPLOADING', 'PROCESSING', 'DONE', 'FAILED', 'WAITING_QUOTA', 'NEEDS_RECONNECT', 'NEEDS_REVIEW', 'CANCELLED'];

describe('publication-actions', () => {
  it('canRetry: solo falló, esperando cuota o reconectar (no «por revisar»)', () => {
    const allowed = ALL.filter(statusCode => canRetry({ statusCode }));
    expect(allowed).toEqual(['FAILED', 'WAITING_QUOTA', 'NEEDS_RECONNECT']);
  });

  it('canCancel: en cola, esperando, o subida interrumpida (no enviándose)', () => {
    const allowed = ALL.filter(statusCode => canCancel({ statusCode, isSending: false }));
    expect(allowed).toEqual(['PENDING', 'UPLOADING', 'WAITING_QUOTA', 'NEEDS_RECONNECT', 'NEEDS_REVIEW']);
    expect(canCancel({ statusCode: 'UPLOADING', isSending: true })).toBe(false);
  });

  it('canResolve solo para «por revisar»; canReupload también para fallidas', () => {
    expect(ALL.filter(statusCode => canResolve({ statusCode }))).toEqual(['NEEDS_REVIEW']);
    expect(ALL.filter(statusCode => canReupload({ statusCode }))).toEqual(['FAILED', 'NEEDS_REVIEW']);
  });

  it('sin publicación no hay acciones', () => {
    expect(canRetry(null)).toBe(false);
    expect(canCancel(undefined)).toBe(false);
    expect(canResolve(null)).toBe(false);
    expect(canReupload(undefined)).toBe(false);
  });
});

describe('mapSettled', () => {
  it('respeta el límite de concurrencia y conserva el orden', async () => {
    let running = 0;
    let peak = 0;
    const results = await mapSettled([1, 2, 3, 4, 5, 6, 7], 3, async n => {
      running++;
      peak = Math.max(peak, running);
      await new Promise(resolve => setTimeout(resolve, 5));
      running--;
      return n * 10;
    });
    expect(peak).toBe(3);
    expect(results.map(r => (r.status === 'fulfilled' ? r.value : null))).toEqual([10, 20, 30, 40, 50, 60, 70]);
  });

  it('no corta si una falla', async () => {
    const results = await mapSettled([1, 2, 3], 2, async n => {
      if (n === 2) throw new Error('mal');
      return n;
    });
    expect(results.map(r => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
  });

  it('lista vacía', async () => {
    expect(await mapSettled([], 3, async () => 1)).toEqual([]);
  });
});
