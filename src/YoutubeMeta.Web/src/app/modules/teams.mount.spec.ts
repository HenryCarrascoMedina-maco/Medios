/** Teams: pantallas montadas (Conexiones, Ajustes, guía, Resultados y diálogo de publicación) sin servidor. */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';
import { ConnectionHttp, InsightsHttp, SettingsHttp } from '@core/http/api.http';
import { IInsights } from '@core/models/api.models';
import { setPublicationRules } from '@core/utils/publication-rules';
import { PublishDialog } from '@shared/publish/publish.dialog';
import { account, pageProviders, video } from '../testing/page-mocks';
import { ConnectionsPage } from './connections/connections.page';
import { isHttpsUrl } from './connections/teams-webhook.dialog';
import { GuidePage } from './guides/guide.page';
import { InsightsPage } from './insights/insights.page';
import { SettingsPage } from './settings/settings.page';

async function settle(fixture: ComponentFixture<unknown>, rounds = 4): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    fixture.detectChanges();
    await fixture.whenStable();
  }
  fixture.detectChanges();
}

const button = (root: HTMLElement, label: string) =>
  [...root.querySelectorAll('button')].find(b => b.textContent?.replace(/\s+/g, ' ').includes(label)) as HTMLButtonElement | undefined;

function type(root: HTMLElement, selector: string, value: string): void {
  const field = root.querySelector(selector) as HTMLInputElement;
  field.value = value;
  field.dispatchEvent(new Event('input'));
}

const graph = account('TEAMS', 1, { externalId: 't1/c1', displayName: 'Marketing › General', accountHint: 'Canal de Teams' });
const webhook = account('TEAMS', 2, { externalId: 'webhook:abc', displayName: 'Soporte', accountHint: 'Canal (webhook)' });

afterEach(() => {
  TestBed.resetTestingModule();
  setPublicationRules(null);
});

describe('Conexiones · Teams', () => {
  async function open(url: string) {
    TestBed.configureTestingModule({ providers: [...pageProviders({ accounts: [graph, webhook] }), provideRouter([{ path: 'connections', component: ConnectionsPage }])] });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    for (let i = 0; i < 3; i++) {
      harness.detectChanges();
      await harness.fixture.whenStable();
    }
    harness.detectChanges();
    return { harness, root: harness.fixture.nativeElement as HTMLElement };
  }

  it('al volver de Microsoft con ?teamsAccount=pick abre el árbol y conecta los canales marcados', async () => {
    const { harness, root } = await open('/connections?teamsAccount=pick&pick=abc');
    const http = TestBed.inject(ConnectionHttp) as unknown as { teamsChannels: jest.Mock; teamsSave: jest.Mock };
    expect(http.teamsChannels).toHaveBeenCalledWith('abc');
    const general = root.querySelector('input[aria-label="Marketing › General"]') as HTMLInputElement;
    expect(general.checked && general.disabled).toBe(true);
    expect(root.textContent).toContain('privado · necesitas ser miembro');
    (root.querySelector('input[aria-label="Marketing › Lanzamientos"]') as HTMLInputElement).click();
    harness.detectChanges();
    button(root, 'Conectar 1')!.click();
    await harness.fixture.whenStable();
    expect(http.teamsSave).toHaveBeenCalledWith('abc', [{ teamId: 't1', channelId: 'c2' }]);
  });

  it('añade un canal por webhook solo con una URL https', async () => {
    const { harness, root } = await open('/connections');
    expect(root.textContent).toContain('Canal (webhook)');
    button(root, 'Añadir canal por webhook')!.click();
    harness.detectChanges();
    type(root, '#wh-name', 'Soporte 2');
    type(root, '#wh-url', 'http://inseguro.com/x');
    harness.detectChanges();
    const add = () => [...root.querySelectorAll('ym-teams-webhook button')].find(b => b.textContent?.trim() === 'Añadir canal') as HTMLButtonElement;
    expect(add().disabled).toBe(true);
    type(root, '#wh-url', 'https://prod.logic.azure.com/workflows/x');
    harness.detectChanges();
    add().click();
    await harness.fixture.whenStable();
    expect((TestBed.inject(ConnectionHttp) as unknown as { teamsWebhook: jest.Mock }).teamsWebhook).toHaveBeenCalledWith('Soporte 2', 'https://prod.logic.azure.com/workflows/x');
  });

  it('isHttpsUrl', () => {
    expect(isHttpsUrl('https://a.logic.azure.com/x')).toBe(true);
    expect(isHttpsUrl('http://a.com')).toBe(false);
    expect(isHttpsUrl('nada')).toBe(false);
  });
});

describe('Ajustes · Teams', () => {
  it('guarda Client ID, secreto, inquilino y caducidad del secreto con platform TEAMS', async () => {
    TestBed.configureTestingModule({ providers: pageProviders() });
    const fixture = TestBed.createComponent(SettingsPage);
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;
    expect((root.querySelector('#tenant-TEAMS') as HTMLInputElement).value).toBe('9f8e7d6c-0000-0000-0000-000000000002');
    type(root, '#secret-TEAMS', 'valor-secreto');
    type(root, '#expiry-TEAMS', '2028-12-01');
    await settle(fixture);
    const card = root.querySelector('#tenant-TEAMS')!.closest('ym-client-card') as HTMLElement;
    expect(card.textContent).toContain('https://api.test/cb');
    button(card, 'Guardar')!.click();
    await settle(fixture);
    expect(TestBed.inject(SettingsHttp).save).toHaveBeenCalledWith({
      platform: 'TEAMS', publicId: '1a2b3c4d-0000-0000-0000-000000000001', secret: 'valor-secreto',
      tenantId: '9f8e7d6c-0000-0000-0000-000000000002', secretExpiresAt: '2028-12-01'
    });
  });

  it('un inquilino que no es GUID no deja guardar', async () => {
    TestBed.configureTestingModule({ providers: pageProviders() });
    const fixture = TestBed.createComponent(SettingsPage);
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;
    type(root, '#tenant-TEAMS', 'kaltrum');
    await settle(fixture);
    const card = root.querySelector('#tenant-TEAMS')!.closest('ym-client-card') as HTMLElement;
    expect(button(card, 'Guardar')!.disabled).toBe(true);
  });
});

describe('Guía de Teams', () => {
  it('arma el enlace de consentimiento con el inquilino y la app guardados', async () => {
    TestBed.configureTestingModule({ providers: [...pageProviders(), provideRouter([{ path: 'guides/:platform', component: GuidePage }])] });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/guides/teams');
    await harness.fixture.whenStable();
    harness.detectChanges();
    const text = (harness.routeNativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('https://login.microsoftonline.com/9f8e7d6c-0000-0000-0000-000000000002/adminconsent?client_id=1a2b3c4d-0000-0000-0000-000000000001');
    expect(text).toContain('Post to a channel when a webhook request is received');
    expect(text).toContain('https://api.test/teams');
  });
});

describe('Resultados · Teams', () => {
  it('Teams no tiene métricas: se muestra «—»', async () => {
    const data: IInsights = {
      days: 30, published: 5, failed: 0, successRate: 100, views: 0, likes: 0, comments: 0, avgMinutes: 1, daily: [],
      accounts: [{ connectionId: 1, platform: 'TEAMS', connectionName: 'Marketing › General', avatarUrl: null, published: 5, failed: 0, views: 0, likes: 0, comments: 0, avgMinutes: 1 }],
      inbox: { received: 0, sent: 0, avgResponseMinutes: null, daily: [], platforms: [] }
    };
    TestBed.configureTestingModule({ providers: pageProviders() });
    (TestBed.inject(InsightsHttp) as unknown as { get: jest.Mock }).get.mockReturnValue(of(data));
    const fixture = TestBed.createComponent(InsightsPage);
    await settle(fixture);
    const row = [...(fixture.nativeElement as HTMLElement).querySelectorAll('tr')].find(r => r.textContent?.includes('Marketing › General'))!;
    expect(row.querySelectorAll('td[title="Esta plataforma no da estadísticas"]').length).toBe(1);
    expect((row.textContent?.match(/—/g) ?? []).length).toBe(3);
  });
});

describe('Diálogo de publicación · Teams', () => {
  it('Graph admite video con @canal y primera respuesta; el webhook explica por qué no', async () => {
    TestBed.configureTestingModule({ providers: pageProviders({ accounts: [graph, webhook] }) });
    const fixture = TestBed.createComponent(PublishDialog);
    fixture.componentRef.setInput('videos', [video()]);
    fixture.componentRef.setInput('accounts', [graph, webhook]);
    fixture.componentRef.setInput('preselected', [1]);
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;
    const row = (name: string) => [...root.querySelectorAll('label.choice')].find(l => l.textContent?.includes(name)) as HTMLElement;
    expect(row('Soporte').textContent).toContain('Un canal conectado por webhook solo admite texto, enlace e imágenes por dirección pública');
    expect((row('Soporte').querySelector('input') as HTMLInputElement).disabled).toBe(true);
    expect(root.textContent).toContain('Avisar a todo el canal');
    expect(root.textContent).toContain('Primera respuesta en el hilo');
    expect(root.textContent).toContain('Vista previa · Teams');
  });
});
