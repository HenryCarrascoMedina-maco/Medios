/**
 * Ajustes › Plantillas montada con servicios HTTP falsos: la lista (publicaciones, respuestas y bloques) y el editor
 * (etiquetas, adjuntos, revisión y guardado).
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';
import { TemplateHttp } from '@core/http/api.http';
import { setPublicationRules } from '@core/utils/publication-rules';
import { pageProviders, publishTemplate, template } from '../testing/page-mocks';
import { TemplateEditPage } from './settings/templates/template-edit.page';
import { TemplatesPage } from './settings/templates/templates.page';

const text = (root: HTMLElement) => root.textContent?.replace(/\s+/g, ' ') ?? '';
const buttonByText = (root: HTMLElement, label: string) =>
  [...root.querySelectorAll('button')].find(b => b.textContent?.replace(/\s+/g, ' ').includes(label)) as HTMLButtonElement | undefined;
const templateHttp = () => TestBed.inject(TemplateHttp) as unknown as Record<string, jest.Mock>;

async function settle(fixture: ComponentFixture<unknown>, rounds = 3): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    fixture.detectChanges();
    await fixture.whenStable();
  }
  fixture.detectChanges();
}

async function openEditor(url: string): Promise<RouterTestingHarness> {
  TestBed.configureTestingModule({
    providers: [...pageProviders(), provideRouter([
      { path: 'settings/templates', component: TemplatesPage },
      { path: 'settings/templates/:id', component: TemplateEditPage }
    ])]
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  for (let i = 0; i < 3; i++) {
    harness.detectChanges();
    await harness.fixture.whenStable();
  }
  harness.detectChanges();
  return harness;
}

afterEach(() => {
  TestBed.resetTestingModule();
  setPublicationRules(null);
});

describe('Ajustes › Plantillas', () => {
  it('lista publicaciones y respuestas con sus etiquetas, adjuntos y uso, y filtra', async () => {
    TestBed.configureTestingModule({ providers: pageProviders() });
    const fixture = TestBed.createComponent(TemplatesPage);
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;
    expect(text(root)).toContain('Envío');
    expect(text(root)).toContain('/envio');
    expect(text(root)).toContain('Lanzamiento');
    expect(text(root)).toContain('Usada 3 veces');
    // Las etiquetas se resaltan también en la tarjeta.
    expect([...root.querySelectorAll('ym-template-text span')].map(s => s.textContent)).toContain('{nombre}');

    buttonByText(root, 'Respuestas')!.click();
    await settle(fixture);
    expect(text(root)).toContain('Envío');
    expect(text(root)).not.toContain('Lanzamiento');

    buttonByText(root, 'Bloques')!.click();
    await settle(fixture);
    expect(text(root)).toContain('#bloque:redes');
  });

  it('marca una plantilla de publicación por defecto y avisa de los adjuntos borrados', async () => {
    TestBed.configureTestingModule({ providers: pageProviders() });
    templateHttp()['list'].mockReturnValue(of([template({ media: [{ ...template().media[0], missing: true }] }), publishTemplate()]));
    const fixture = TestBed.createComponent(TemplatesPage);
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;
    expect(text(root)).toContain('1 archivo ya no está en la biblioteca');

    buttonByText(root, 'Por defecto')!.click();
    await settle(fixture);
    expect(templateHttp()['save']).toHaveBeenCalledWith(expect.objectContaining({ name: 'Lanzamiento', isDefault: true, usage: 'PUBLISH' }), 2);
  });
});

describe('Editor de plantillas', () => {
  it('edita una respuesta: revisa etiquetas y campos, y guarda con atajo y adjuntos', async () => {
    const harness = await openEditor('/settings/templates/1');
    const root = harness.routeNativeElement!;
    expect((root.querySelector('#tpl-shortcut') as HTMLInputElement).value).toBe('envio');
    expect(text(root)).toContain('Se preguntará al usarla: precio');
    // La vista previa usa el cliente de ejemplo y deja los campos entre corchetes.
    expect(text(root)).toContain('Hola María López, el envío cuesta [precio].');

    const body = root.querySelector('#tpl-body') as HTMLTextAreaElement;
    body.value = 'Hola {nombre} {titulo}';
    body.dispatchEvent(new Event('input'));
    harness.detectChanges();
    expect(text(root)).toContain('{titulo} solo vale en publicaciones');
    expect(text(root)).toContain('Cambios sin guardar');

    buttonByText(root, 'Guardar')!.click();
    await harness.fixture.whenStable();
    expect(templateHttp()['save']).toHaveBeenCalledWith(expect.objectContaining({
      usage: 'REPLY', shortcut: 'envio', title: null, body: 'Hola {nombre} {titulo}', media: [{ mediaId: 21, alt: null }]
    }), 1);
  });

  it('una nueva no se guarda sin nombre y pregunta antes de salir con cambios', async () => {
    const harness = await openEditor('/settings/templates/new');
    const root = harness.routeNativeElement!;
    expect(text(root)).toContain('Nueva plantilla');
    expect(text(root)).toContain('Falta el nombre.');

    const name = root.querySelector('#tpl-name') as HTMLInputElement;
    name.value = 'Promo';
    name.dispatchEvent(new Event('input'));
    harness.detectChanges();
    expect(buttonByText(root, 'Guardar')!.disabled).toBe(false);

    const page = harness.routeDebugElement!.componentInstance as TemplateEditPage;
    const leave = page.canLeave();
    expect(leave).toBeInstanceOf(Promise);
  });
});
