import { ToastService } from '@core/services/toast.service';

export async function copyText(toast: ToastService, text: string | null, done = 'Copiado.'): Promise<void> {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    toast.info(done);
  } catch {
    toast.warning('No se pudo copiar; selecciónalo a mano.');
  }
}
