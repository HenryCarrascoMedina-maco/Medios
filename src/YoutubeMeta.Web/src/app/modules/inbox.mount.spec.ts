/**
 * Inicio, Bandeja y Ajustes › Bandeja montados con TestBed y servicios HTTP falsos: se crean sin errores de ejecución,
 * pintan los datos y llaman a la API como deben.
 */
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';
import { signal } from '@angular/core';
import { InboxHttp, TemplateHttp } from '@core/http/api.http';
import { HealthService } from '@core/services/health.service';
import { InboxCountsService } from '@core/services/inbox-counts.service';
import { setPublicationRules } from '@core/utils/publication-rules';
import { NAV, ShellComponent } from '../layout/shell.component';
import { SERVER_RULES, agendaContact, conversation, inboxMessage, inboxSettings, pageProviders } from '../testing/page-mocks';
import { HomePage } from './home/home.page';
import { InboxPage } from './inbox/inbox.page';
import { InboxStore } from './inbox/inbox.store';
import { InboxSettingsPage } from './settings/inbox-settings.page';

async function settle(fixture: ComponentFixture<unknown>, rounds = 3): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    fixture.detectChanges();
    await fixture.whenStable();
  }
  fixture.detectChanges();
}

const text = (root: HTMLElement) => root.textContent?.replace(/\s+/g, ' ') ?? '';
const buttonByText = (root: HTMLElement, label: string) =>
  [...root.querySelectorAll('button')].find(b => b.textContent?.replace(/\s+/g, ' ').includes(label)) as HTMLButtonElement | undefined;
const inboxHttp = () => TestBed.inject(InboxHttp) as unknown as Record<string, jest.Mock>;

afterEach(() => {
  TestBed.resetTestingModule();
  setPublicationRules(null);
});

describe('Inicio', () => {
  it('muestra las cifras, lo urgente de la bandeja y la agenda', async () => {
    TestBed.configureTestingModule({ providers: pageProviders() });
    const fixture = TestBed.createComponent(HomePage);
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;
    expect(text(root)).toContain('Sin responder');
    expect(text(root)).toContain('38 min');
    expect(text(root)).toContain('12 min más rápido');
    expect(text(root)).toContain('Lucía Pérez');
    expect(text(root)).toContain('Promo noviembre');
    expect(root.querySelector('ym-bar-chart')).not.toBeNull();
  });
});

describe('Bandeja', () => {
  async function openConversation(id: number, overrides = {}) {
    TestBed.configureTestingModule({
      providers: [...pageProviders(), provideRouter([{ path: 'inbox', component: InboxPage }, { path: 'inbox/:id', component: InboxPage }])]
    });
    inboxHttp()['conversation'].mockReturnValue(of(conversation(overrides)));
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(`/inbox/${id}`);
    harness.detectChanges();
    await harness.fixture.whenStable();
    harness.detectChanges();
    return harness;
  }

  it('abre la conversación de la URL, la marca como leída y pinta los mensajes', async () => {
    const harness = await openConversation(1);
    const root = harness.routeNativeElement!;
    expect(text(root)).toContain('¿Tienen envío a Cusco?');
    expect(text(root)).toContain('WhatsApp · Ventas');
    expect(inboxHttp()['update']).toHaveBeenCalledWith(1, { markRead: true });
  });

  it('una respuesta va a la cola y aparece al momento', async () => {
    const harness = await openConversation(1);
    const root = harness.routeNativeElement!;
    const textarea = root.querySelector('ym-composer textarea') as HTMLTextAreaElement;
    textarea.value = 'Sí, enviamos';
    textarea.dispatchEvent(new Event('input'));
    harness.detectChanges();
    buttonByText(root, 'Enviar')!.click();
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(inboxHttp()['send']).toHaveBeenCalledWith(1, expect.objectContaining({ body: 'Sí, enviamos', mediaIds: [] }));
    expect(text(root)).toContain('En cola');
  });

  it('«/envio» aplica la respuesta propia: nombre del cliente, campo a completar y adjunto', async () => {
    const harness = await openConversation(1);
    const root = harness.routeNativeElement!;
    const textarea = root.querySelector('ym-composer textarea') as HTMLTextAreaElement;
    textarea.value = '/env';
    textarea.dispatchEvent(new Event('input'));
    harness.detectChanges();
    await harness.fixture.whenStable();
    harness.detectChanges();
    (root.querySelector('[aria-label="Tus respuestas"] button') as HTMLButtonElement).click();
    harness.detectChanges();

    // Hasta completar el campo no se puede enviar.
    expect(buttonByText(root, 'Enviar')!.disabled).toBe(true);
    expect(text(root)).toContain('Tarifas');
    const field = root.querySelector('ym-template-fields input[aria-label="precio"]') as HTMLInputElement;
    field.value = 'S/ 15';
    field.dispatchEvent(new Event('input'));
    harness.detectChanges();
    await harness.fixture.whenStable();
    expect(textarea.value).toBe('Hola Lucía Pérez, el envío cuesta S/ 15.');

    buttonByText(root, 'Enviar')!.click();
    await harness.fixture.whenStable();
    expect(inboxHttp()['send']).toHaveBeenCalledWith(1, expect.objectContaining({ body: 'Hola Lucía Pérez, el envío cuesta S/ 15.', mediaIds: [21] }));
    await new Promise(resolve => setTimeout(resolve));
    expect((TestBed.inject(TemplateHttp) as unknown as Record<string, jest.Mock>)['used']).toHaveBeenCalledWith(1);
  });

  it('con la ventana de WhatsApp cerrada propone una plantilla', async () => {
    const harness = await openConversation(1, { windowExpiresAt: '2020-01-01T00:00:00Z' });
    await harness.fixture.whenStable();
    harness.detectChanges();
    const root = harness.routeNativeElement!;
    expect(inboxHttp()['templates']).toHaveBeenCalledWith(1);
    expect(text(root)).toContain('No hay plantillas aprobadas');
  });

  describe('Nueva conversación', () => {
    const typeInto = (el: HTMLInputElement | HTMLSelectElement, value: string, event = 'input') => {
      el.value = value;
      el.dispatchEvent(new Event(event));
    };

    it('WhatsApp: escribe primero a un número con plantilla y consentimiento', async () => {
      const { harness, dialog } = await openDialogWith({
        templates: [{ name: 'bienvenida', language: 'es', category: 'MARKETING', status: 'APPROVED', body: 'Hola {{1}}', paramCount: 1 }]
      });
      typeInto(dialog.querySelector('#nc-phone') as HTMLInputElement, '+51 987 654 321');
      harness.detectChanges();
      typeInto(dialog.querySelector('ym-template-picker select') as HTMLSelectElement, 'bienvenida|es', 'change');
      harness.detectChanges();
      typeInto(dialog.querySelector('input[aria-label="Variable 1"]') as HTMLInputElement, 'Juan');
      (dialog.querySelector('input[type="checkbox"]') as HTMLInputElement).click();
      harness.detectChanges();
      expect(text(dialog)).toContain('Hola Juan');

      buttonByText(dialog, 'Enviar plantilla')!.click();
      await harness.fixture.whenStable();
      expect(inboxHttp()['startConversation']).toHaveBeenCalledWith(expect.objectContaining({
        connectionId: 1, phone: '+51 987 654 321', templateName: 'bienvenida', templateLanguage: 'es', templateParams: ['Juan'], consent: true
      }));
    });

    it('Telegram: no deja escribir primero y crea un enlace de invitación para el contacto', async () => {
      const { harness, dialog } = await openDialogWith({ telegram: true, contacts: [agendaContact()] });
      buttonByText(dialog, 'Telegram')!.click();
      harness.detectChanges();
      expect(text(dialog)).toContain('no deja escribir primero');

      typeInto(dialog.querySelector('input[aria-label="Buscar contacto"]') as HTMLInputElement, 'Juan');
      await new Promise(resolve => setTimeout(resolve, 350));
      await harness.fixture.whenStable();
      harness.detectChanges();
      buttonByText(dialog, 'Juan Pérez')!.click();
      harness.detectChanges();
      buttonByText(dialog, 'Crear enlace')!.click();
      await harness.fixture.whenStable();
      harness.detectChanges();

      expect(inboxHttp()['createInvite']).toHaveBeenCalledWith(3, 20);
      expect((dialog.querySelector('#nc-link') as HTMLInputElement).value).toBe('https://t.me/kaltrum_bot?start=inv0011');
      expect(text(dialog)).toContain('Enviar por correo');
    });

    async function openDialogWith(options: { templates?: unknown[]; telegram?: boolean; contacts?: unknown[] }) {
      TestBed.configureTestingModule({
        providers: [...pageProviders(), provideRouter([{ path: 'inbox', component: InboxPage }, { path: 'inbox/:id', component: InboxPage }])]
      });
      const http = inboxHttp();
      if (options.templates) http['templates'].mockReturnValue(of(options.templates));
      if (options.contacts) http['searchContacts'].mockReturnValue(of(options.contacts));
      if (options.telegram) {
        const settings = inboxSettings();
        settings.accounts.push({ ...settings.accounts[0], id: 3, platform: 'TELEGRAM', name: 'Soporte', accountHint: '@kaltrum_bot' });
        http['settings'].mockReturnValue(of(settings));
      }
      const harness = await RouterTestingHarness.create();
      await harness.navigateByUrl('/inbox');
      harness.detectChanges();
      buttonByText(harness.routeNativeElement!, 'Nueva conversación')!.click();
      for (let i = 0; i < 3; i++) {
        await harness.fixture.whenStable();
        harness.detectChanges();
      }
      return { harness, dialog: document.querySelector('ym-new-conversation-dialog') as HTMLElement };
    }
  });

  it('los comentarios se agrupan por hilo', () => {
    TestBed.configureTestingModule({ providers: [...pageProviders(), InboxStore] });
    const store = TestBed.inject(InboxStore);
    store.messages.value.set([
      inboxMessage({ id: 3, externalId: 'c2', parentExternalId: 'c1', sentAt: '2026-11-16T11:00:00Z', direction: 'OUT' }),
      inboxMessage({ id: 2, externalId: 'c3', sentAt: '2026-11-16T10:50:00Z' }),
      inboxMessage({ id: 1, externalId: 'c1', sentAt: '2026-11-16T10:40:00Z' })
    ]);
    const threads = store.threads();
    expect(threads.map(t => t.root.id)).toEqual([1, 2]);
    expect(threads[0].replies.map(r => r.id)).toEqual([3]);
  });
});

describe('Ajustes › Bandeja', () => {
  it('explica qué falta en cada cuenta y guarda los interruptores', async () => {
    TestBed.configureTestingModule({ providers: pageProviders() });
    const fixture = TestBed.createComponent(InboxSettingsPage);
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;
    expect(text(root)).toContain('dirección pública con https');
    expect(text(root)).toContain('Falta el permiso para leer y responder comentarios');
    expect(text(root)).toContain('Volver a conectar');
    expect(text(root)).toContain('Ver en Plantillas');

    (root.querySelector('input[aria-label="Recibir privados de Ventas"]') as HTMLInputElement).click();
    await settle(fixture);
    expect(inboxHttp()['saveAccount']).toHaveBeenCalledWith(1, { inboxDirect: false, inboxComments: false });
  });
});

describe('Menú por módulos', () => {
  it('agrupa Inicio y Bandeja arriba y luego Publicar, Análisis y Configuración', () => {
    expect(NAV.map(g => g.label)).toEqual([null, 'Publicar', 'Análisis', 'Configuración']);
    expect(NAV[0].items.map(i => i.path)).toEqual(['/home', '/inbox']);
    expect(NAV.flatMap(g => g.items).filter(i => i.mobile).length).toBeLessThanOrEqual(4);
  });

  it('el shell muestra los grupos y el número de conversaciones sin leer', async () => {
    // Sin temporizadores (la salud se consulta cada 2 min y los contadores esperan 400 ms): whenStable terminaría nunca.
    TestBed.configureTestingModule({
      providers: [
        ...pageProviders(), provideHttpClient(), provideHttpClientTesting(),
        { provide: HealthService, useValue: { health: signal(null), poll: jest.fn() } },
        { provide: InboxCountsService, useValue: { counts: signal({ open: 1, pending: 0, closed: 0, unread: 1, awaiting: 1 }), watch: jest.fn(), refresh: jest.fn() } }
      ]
    });
    setPublicationRules(SERVER_RULES);
    const fixture = TestBed.createComponent(ShellComponent);
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;
    for (const label of ['Inicio', 'Bandeja', 'Publicar', 'Configuración', 'Guías']) expect(text(root)).toContain(label);
    expect(root.querySelector('[aria-label="1 sin leer"]')).not.toBeNull();
  });
});
