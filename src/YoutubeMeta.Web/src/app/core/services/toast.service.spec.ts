import { ToastService } from './toast.service';

describe('ToastService', () => {
  let service: ToastService;

  beforeEach(() => {
    jest.useFakeTimers();
    service = new ToastService();
  });

  afterEach(() => jest.useRealTimers());

  it('no repite un aviso igual que ya se ve (sin lluvia de errores)', () => {
    service.error('Sin conexión con el servidor.');
    service.error('Sin conexión con el servidor.');
    service.error('Sin conexión con el servidor.');
    expect(service.toasts()).toHaveLength(1);
  });

  it('el repetido alarga su tiempo en pantalla', () => {
    service.info('Hola');
    jest.advanceTimersByTime(4000);
    service.info('Hola');
    jest.advanceTimersByTime(4000);
    expect(service.toasts()).toHaveLength(1);
    jest.advanceTimersByTime(1000);
    expect(service.toasts()).toHaveLength(0);
  });

  it('como mucho 5 a la vez; se van los más antiguos', () => {
    for (let i = 0; i < 7; i++) service.info(`aviso ${i}`);
    expect(service.toasts().map(t => t.message)).toEqual(['aviso 2', 'aviso 3', 'aviso 4', 'aviso 5', 'aviso 6']);
  });
});
