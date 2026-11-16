/**
 * Monta las páginas con TestBed y servicios HTTP falsos. Si una página falla al crearse (p. ej. NG0203 por un
 * toObservable/effect fuera del contexto de inyección), estas pruebas lo detectan sin abrir el navegador.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';
import { PublicationHttp, SettingsHttp } from '@core/http/api.http';
import { ICalendarItem } from '@core/models/api.models';
import { ToastService } from '@core/services/toast.service';
import { setPublicationRules } from '@core/utils/publication-rules';
import { account, image, pageProviders, publication, video } from '../testing/page-mocks';
import { CalendarPage } from './calendar/calendar.page';
import { ConnectionsPage } from './connections/connections.page';
import { GuidePage } from './guides/guide.page';
import { LibraryPage } from './library/library.page';
import { PublicationsPage } from './publications/publications.page';
import { SettingsPage } from './settings/settings.page';
import { VideoDetailPage } from './video-detail/video-detail.page';

async function settle(fixture: ComponentFixture<unknown>, rounds = 3): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    fixture.detectChanges();
    await fixture.whenStable();
  }
  fixture.detectChanges();
}

const text = (fixture: ComponentFixture<unknown>) => (fixture.nativeElement as HTMLElement).textContent ?? '';
const buttonByText = (root: HTMLElement, label: string) =>
  [...root.querySelectorAll('button')].find(b => b.textContent?.replace(/\s+/g, ' ').includes(label)) as HTMLButtonElement | undefined;

afterEach(() => {
  TestBed.resetTestingModule();
  setPublicationRules(null);
});

describe('LibraryPage (Medios)', () => {
  const media = [video({ id: 1, title: 'Demo producto' }), image(2), image(3)];

  it('se monta con los filtros por tipo y las miniaturas de cada tipo', async () => {
    TestBed.configureTestingModule({ providers: pageProviders({ videos: media }) });
    const fixture = TestBed.createComponent(LibraryPage);
    await settle(fixture);
    expect(text(fixture)).toContain('Medios');
    for (const label of ['Todos', 'Videos', 'Imágenes', 'PDF']) expect(text(fixture)).toContain(label);
    expect(fixture.nativeElement.querySelectorAll('ym-video-card').length).toBe(3);
    expect(fixture.nativeElement.querySelector('input[type="file"]').getAttribute('accept')).toContain('.pdf');
  });

  it('«Crear publicación» abre el diálogo con los medios en el orden en que se marcaron', async () => {
    TestBed.configureTestingModule({ providers: pageProviders({ videos: media, accounts: [account('LINKEDIN')] }) });
    const fixture = TestBed.createComponent(LibraryPage);
    await settle(fixture);
    const boxes = fixture.nativeElement.querySelectorAll('ym-video-card input[type="checkbox"]') as NodeListOf<HTMLInputElement>;
    boxes[2].click();
    boxes[1].click();
    await settle(fixture);
    buttonByText(fixture.nativeElement, 'Crear publicación')!.click();
    await settle(fixture, 5);
    const strip = [...fixture.nativeElement.querySelectorAll('ym-media-strip li .truncate')].map(e => (e as HTMLElement).textContent?.trim());
    expect(strip).toEqual(['Imagen 3', 'Imagen 2']);
    expect(text(fixture)).toContain('Carrusel · 2');
  });

  it('«Nueva publicación» abre el diálogo sin medios (texto o enlace)', async () => {
    TestBed.configureTestingModule({ providers: pageProviders({ videos: media }) });
    const fixture = TestBed.createComponent(LibraryPage);
    await settle(fixture);
    buttonByText(fixture.nativeElement, 'Nueva publicación')!.click();
    await settle(fixture, 5);
    expect(fixture.nativeElement.querySelector('#pub-link')).not.toBeNull();
    expect(text(fixture)).toContain('Texto');
  });
});

describe('PublicationsPage', () => {
  it('muestra el tipo, publicaciones sin medios sin enlace roto y «Reintentar comentario»', async () => {
    const items = [
      publication({ id: 1, postKind: 'CAROUSEL', mediaCount: 4, commentPending: true }),
      publication({ id: 2, postKind: 'TEXT', mediaCount: 0, videoId: null, videoTitle: 'Lanzamos la versión 2' })
    ];
    TestBed.configureTestingModule({ providers: pageProviders({ publications: items }) });
    const fixture = TestBed.createComponent(PublicationsPage);
    await settle(fixture);
    expect(text(fixture)).toContain('Carrusel · 4');
    expect(text(fixture)).toContain('Lanzamos la versión 2');
    const links = [...fixture.nativeElement.querySelectorAll('a')].map(a => (a as HTMLAnchorElement).getAttribute('href'));
    expect(links.some(h => h?.includes('/videos/null'))).toBe(false);

    buttonByText(fixture.nativeElement, 'Reintentar comentario')!.click();
    await settle(fixture);
    expect(TestBed.inject(PublicationHttp).retryComment).toHaveBeenCalledWith(1);
  });
});

describe('CalendarPage', () => {
  it('pinta las publicaciones de LinkedIn con su color y el icono del tipo', async () => {
    const now = new Date();
    const item: ICalendarItem = {
      id: 7, videoId: null, postId: 3, postKind: 'LINK', videoTitle: 'Versión 2', hasPoster: false, target: 'LINKEDIN', connectionId: 1, connectionName: 'Henry',
      connectionAvatarUrl: null, title: 'Versión 2', statusCode: 'PENDING', publishAt: now.toISOString(), when: now.toISOString(), externalUrl: null, canReschedule: true
    };
    const providers = pageProviders();
    TestBed.configureTestingModule({ providers });
    const http = TestBed.inject(PublicationHttp) as unknown as { calendar: jest.Mock };
    http.calendar.mockReturnValue(of([item]));
    const fixture = TestBed.createComponent(CalendarPage);
    await settle(fixture);
    const chip = fixture.nativeElement.querySelector('button.bg-linkedin') as HTMLButtonElement;
    expect(chip).not.toBeNull();
    expect(chip.querySelector('[aria-label="Enlace"]')).not.toBeNull();
    chip.click();
    await settle(fixture);
    expect(text(fixture)).toContain('Publicación:');
  });
});

describe('ConnectionsPage', () => {
  const soon = new Date(Date.now() + 5 * 24 * 3600_000 - 60_000).toISOString();

  it('tarjeta de LinkedIn con perfil y página de empresa, aviso de caducidad y resultado del OAuth', async () => {
    const accounts = [account('LINKEDIN', 1, { accountHint: 'Perfil personal', tokenExpiresAt: soon })];
    TestBed.configureTestingModule({ providers: [...pageProviders({ accounts }), provideRouter([{ path: 'connections', component: ConnectionsPage }])] });
    const toast = TestBed.inject(ToastService);
    const error = jest.spyOn(toast, 'error');
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/connections?linkedinAccount=error&reason=no_pages');
    harness.detectChanges();
    await harness.fixture.whenStable();
    harness.detectChanges();
    const root = harness.routeNativeElement as HTMLElement;
    expect(buttonByText(root, 'Conectar perfil')?.disabled).toBe(false);
    expect(buttonByText(root, 'Conectar página de empresa')?.disabled).toBe(true);
    expect(root.textContent).toContain('Caduca en 5 días');
    expect(error).toHaveBeenCalledWith(expect.stringContaining('no administra ninguna página de empresa'));
  });
});

describe('SettingsPage', () => {
  it('ofrece las dos apps de LinkedIn y guarda la de empresa como LINKEDIN_ORG', async () => {
    TestBed.configureTestingModule({ providers: pageProviders() });
    const fixture = TestBed.createComponent(SettingsPage);
    await settle(fixture);
    expect(text(fixture)).toContain('LinkedIn · perfil personal');
    expect(text(fixture)).toContain('LinkedIn · páginas de empresa');
    const id = fixture.nativeElement.querySelector('#id-LINKEDIN_ORG') as HTMLInputElement;
    id.value = 'org-client';
    id.dispatchEvent(new Event('input'));
    await settle(fixture);
    const card = id.closest('ym-client-card') as HTMLElement;
    // Sin clave guardada, el secreto es obligatorio: «Guardar» espera a que se escriba.
    expect(buttonByText(card, 'Guardar')?.disabled).toBe(true);
    const secret = fixture.nativeElement.querySelector('#secret-LINKEDIN_ORG') as HTMLInputElement;
    secret.value = 'org-secret';
    secret.dispatchEvent(new Event('input'));
    await settle(fixture);
    buttonByText(card, 'Guardar')!.click();
    await settle(fixture);
    expect(TestBed.inject(SettingsHttp).save).toHaveBeenCalledWith({ platform: 'LINKEDIN_ORG', publicId: 'org-client', secret: 'org-secret' });
  });

  it('marca con asterisco los campos obligatorios y exige el inquilino de Teams', async () => {
    TestBed.configureTestingModule({ providers: pageProviders() });
    const fixture = TestBed.createComponent(SettingsPage);
    await settle(fixture);
    const label = fixture.nativeElement.querySelector('label[for="tenant-TEAMS"]') as HTMLElement;
    expect(label?.querySelector('ym-req')).not.toBeNull();
    const card = label.closest('ym-client-card') as HTMLElement;
    for (const [sel, value] of [['#id-TEAMS', '11111111-1111-1111-1111-111111111111'], ['#secret-TEAMS', 's']] as const) {
      const input = fixture.nativeElement.querySelector(sel) as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    }
    const tenant = fixture.nativeElement.querySelector('#tenant-TEAMS') as HTMLInputElement;
    tenant.value = '';
    tenant.dispatchEvent(new Event('input'));
    await settle(fixture);
    expect(buttonByText(card, 'Guardar')?.disabled).toBe(true);
  });
});

describe('GuidePage', () => {
  it('abre la guía de LinkedIn con la URL de retorno del servidor', async () => {
    TestBed.configureTestingModule({ providers: [...pageProviders(), provideRouter([{ path: 'guides/:platform', component: GuidePage }])] });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/guides/linkedin');
    await harness.fixture.whenStable();
    harness.detectChanges();
    const root = harness.routeNativeElement as HTMLElement;
    expect(root.textContent).toContain('Conectar LinkedIn');
    expect(root.textContent).toContain('Community Management API');
    expect(root.textContent).toContain('https://api.test/li');
  });

  it('las guías de Facebook e Instagram explican el primer comentario', async () => {
    TestBed.configureTestingModule({ providers: [...pageProviders(), provideRouter([{ path: 'guides/:platform', component: GuidePage }])] });
    const harness = await RouterTestingHarness.create();
    for (const [guide, permission] of [['facebook', 'pages_manage_engagement'], ['instagram', 'instagram_manage_comments']]) {
      await harness.navigateByUrl(`/guides/${guide}`);
      harness.detectChanges();
      expect((harness.routeNativeElement as HTMLElement).textContent).toContain(permission);
    }
  });
});

describe('VideoDetailPage', () => {
  it('una imagen se muestra sin reproductor ni duración', async () => {
    TestBed.configureTestingModule({ providers: pageProviders({ videos: [image(4)] }) });
    const fixture = TestBed.createComponent(VideoDetailPage);
    fixture.componentRef.setInput('id', '4');
    await settle(fixture);
    expect(fixture.nativeElement.querySelector('ym-video-player')).toBeNull();
    expect(fixture.nativeElement.querySelector('ym-media-thumb')).not.toBeNull();
    expect(text(fixture)).not.toContain('Duración');
  });
});
