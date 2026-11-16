/**
 * Una plataforma desactivada en el servidor (Platforms:Disabled, hoy LinkedIn) no aparece en ninguna pantalla: ni en las
 * pestañas de las guías, ni en Conexiones, ni en los filtros, ni en las claves de Ajustes.
 */
import { Type } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { CONNECT_PLATFORMS } from '@core/constants/status.constants';
import { PublicationHttp } from '@core/http/api.http';
import { setPublicationRules } from '@core/utils/publication-rules';
import { SERVER_RULES, pageProviders, publication } from '../testing/page-mocks';
import { ConnectionsPage } from './connections/connections.page';
import { GuidePage } from './guides/guide.page';
import { PublicationsPage } from './publications/publications.page';
import { SettingsPage } from './settings/settings.page';

const WITHOUT_LINKEDIN = { ...SERVER_RULES, enabledPlatforms: CONNECT_PLATFORMS.filter(p => p !== 'LINKEDIN') };

async function mount<T>(page: Type<T>): Promise<ComponentFixture<T>> {
  // Sin datos de LinkedIn (como la base real): lo que se comprueba es que la interfaz no lo ofrece.
  TestBed.configureTestingModule({ providers: pageProviders({ accounts: [], publications: [publication({ target: 'YOUTUBE', connectionName: 'Canal' })] }) });
  (TestBed.inject(PublicationHttp) as unknown as { rules: jest.Mock }).rules.mockReturnValue(of(WITHOUT_LINKEDIN));
  const fixture = TestBed.createComponent(page);
  for (let i = 0; i < 3; i++) {
    fixture.detectChanges();
    await fixture.whenStable();
  }
  fixture.detectChanges();
  return fixture;
}

afterEach(() => {
  TestBed.resetTestingModule();
  setPublicationRules(null);
});

describe('LinkedIn desactivado', () => {
  it.each([
    ['Guías', GuidePage],
    ['Conexiones', ConnectionsPage],
    ['Publicaciones', PublicationsPage],
    ['Ajustes', SettingsPage]
  ])('no aparece en %s', async (_name, page) => {
    const fixture = await mount(page as new (...args: never[]) => unknown);
    const html = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(html).not.toMatch(/linkedin/i);
    expect(html).toMatch(/YouTube|Plataformas/);
  });
});
