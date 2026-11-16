import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PublicationHttp } from '@core/http/api.http';
import { IConnection, IVideo } from '@core/models/api.models';
import { setPublicationRules } from '@core/utils/publication-rules';
import { account, image, pageProviders, pdf, publishTemplate } from '../../testing/page-mocks';
import { PublishDialog } from './publish.dialog';

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  for (let i = 0; i < 4; i++) {
    fixture.detectChanges();
    await fixture.whenStable();
  }
  fixture.detectChanges();
}

function type(fixture: ComponentFixture<unknown>, selector: string, value: string): void {
  const field = fixture.nativeElement.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement;
  field.value = value;
  field.dispatchEvent(new Event('input'));
}

async function mount(videos: IVideo[], accounts: IConnection[], preselected: number[] = []) {
  TestBed.configureTestingModule({ providers: pageProviders({ accounts }) });
  const fixture = TestBed.createComponent(PublishDialog);
  fixture.componentRef.setInput('videos', videos);
  fixture.componentRef.setInput('asPost', true);
  fixture.componentRef.setInput('accounts', accounts);
  fixture.componentRef.setInput('preselected', preselected);
  await settle(fixture);
  const el = fixture.nativeElement as HTMLElement;
  /** Fila de la cuenta en «¿Dónde se publica?». */
  const row = (name: string) => [...el.querySelectorAll('label.choice')].find(l => l.textContent?.includes(name)) as HTMLElement;
  return { fixture, el, row };
}

describe('PublishDialog', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    TestBed.resetTestingModule();
    setPublicationRules(null);
  });

  it('sin medios es una publicación de texto: YouTube dice por qué no está disponible', async () => {
    const { el, row } = await mount([], [account('YOUTUBE', 1, { displayName: 'Canal' }), account('LINKEDIN', 2, { displayName: 'Henry' })]);
    expect(el.querySelector('#pub-link')).not.toBeNull();
    expect(row('Canal').textContent).toContain('YouTube no admite publicaciones de tipo texto');
    expect((row('Canal').querySelector('input') as HTMLInputElement).disabled).toBe(true);
    expect((row('Henry').querySelector('input') as HTMLInputElement).disabled).toBe(false);
  });

  it('un carrusel en Instagram sin dominio público explica el motivo', async () => {
    const { row } = await mount([image(2), image(3)], [account('INSTAGRAM', 1, { displayName: 'kaltrum' })]);
    expect(row('kaltrum').textContent).toContain('necesita que la app esté publicada en un dominio');
  });

  it('abierta con una plantilla: carga sus fotos, pide sus campos y resuelve {cuenta}', async () => {
    TestBed.configureTestingModule({ providers: pageProviders({ accounts: [account('FACEBOOK', 1, { displayName: 'Kaltrum Store' })] }) });
    const fixture = TestBed.createComponent(PublishDialog);
    const template = publishTemplate({
      body: 'Este finde, {?descuento} en {cuenta}',
      media: [2, 3].map((id, position) => ({
        position, mediaId: id, altText: id === 2 ? 'Portada' : null, title: `Imagen ${id}`, originalFileName: `i${id}.jpg`, contentType: 'image/jpeg', sizeBytes: 1000,
        durationSec: null, width: 1080, height: 1080, mediaKind: 'IMAGE' as const, hasPoster: true, missing: false, createdBy: 'admin', createdAt: '2026-11-01T00:00:00Z'
      }))
    });
    fixture.componentRef.setInput('videos', []);
    fixture.componentRef.setInput('asPost', true);
    fixture.componentRef.setInput('accounts', [account('FACEBOOK', 1, { displayName: 'Kaltrum Store' })]);
    fixture.componentRef.setInput('preselected', [1]);
    fixture.componentRef.setInput('template', template);
    await settle(fixture);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Se cargaron 2 archivos de la plantilla');
    expect(el.textContent).toContain('completa los datos de la plantilla: descuento');

    type(fixture, 'ym-template-fields input[aria-label="descuento"]', '20%');
    await settle(fixture);
    expect(el.textContent).not.toContain('completa los datos de la plantilla');
    expect(el.textContent).toContain('Este finde, 20% en Kaltrum Store');
  });

  it('mezclar imágenes y PDF es un error de la publicación', async () => {
    const { el } = await mount([image(2), pdf(3)], [account('LINKEDIN')]);
    expect(el.textContent).toContain('no se pueden mezclar videos, imágenes y PDF');
  });

  it('LinkedIn: primer comentario, texto alternativo y orden de los medios llegan a la API', async () => {
    const { fixture, el } = await mount([image(3), image(2)], [account('LINKEDIN', 1, { displayName: 'Henry' })], [1]);
    expect(el.textContent).toContain('Vista previa · LinkedIn');
    type(fixture, '#pub-desc', 'Cuatro aprendizajes');
    type(fixture, 'ym-media-strip input', 'Infografía A');
    await settle(fixture);
    type(fixture, '#fc-1', '#marketing');
    const consent = [...el.querySelectorAll('input[type="checkbox"]')].at(-1) as HTMLInputElement;
    consent.click();
    await settle(fixture);
    const publish = [...el.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Publicar') as HTMLButtonElement;
    expect(publish.disabled).toBe(false);
    publish.click();
    await settle(fixture);
    const create = TestBed.inject(PublicationHttp).create as jest.Mock;
    expect(create).toHaveBeenCalledTimes(1);
    const body = create.mock.calls[0][0];
    expect(body.media).toEqual([{ id: 3, alt: 'Infografía A' }, { id: 2 }]);
    expect(body.linkUrl).toBeUndefined();
    expect(body.destinations[0]).toMatchObject({ connectionId: 1, description: 'Cuatro aprendizajes', privacyStatus: 'public', options: { firstComment: '#marketing' } });
  });
});
