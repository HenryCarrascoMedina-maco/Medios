import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BarChartComponent, IBarDatum } from './bar-chart.component';
import { FilterChipsComponent, IFilterOption } from './filter-chips.component';
import { TagEditorComponent } from './tag-editor.component';
import { TemplateEditorComponent } from './template-editor.component';

describe('TagEditorComponent', () => {
  @Component({
    imports: [TagEditorComponent],
    template: `<ym-tag-editor [(tags)]="tags" [suggestions]="[{ tag: 'cocina', videoCount: 3 }]" />`
  })
  class Host {
    readonly tags = signal<string[]>(['baño']);
  }

  const setup = () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    const type = (value: string) => {
      input.value = value;
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    };
    return { fixture, input, type };
  };

  it('añade con Intro normalizando como el servidor', () => {
    const { fixture, input, type } = setup();
    type('#Recetas Rápidas');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.detectChanges();
    expect(fixture.componentInstance.tags()).toEqual(['baño', 'recetas-rápidas']);
  });

  it('una coma confirma y no repite etiquetas', () => {
    const { fixture, type } = setup();
    type('baño, nueva,');
    expect(fixture.componentInstance.tags()).toEqual(['baño', 'nueva']);
  });

  it('el botón ✕ quita la etiqueta y sugiere solo las que faltan', () => {
    const { fixture } = setup();
    (fixture.nativeElement.querySelector('button[aria-label="Quitar baño"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.tags()).toEqual([]);
    expect(fixture.nativeElement.querySelectorAll('datalist option').length).toBe(1);
  });
});

describe('FilterChipsComponent', () => {
  @Component({
    imports: [FilterChipsComponent],
    template: `<ym-filter-chips ariaLabel="Estado" [options]="options" [(value)]="value" />`
  })
  class Host {
    readonly options: IFilterOption<string>[] = [{ value: '', label: 'Todos' }, { value: 'ERROR', label: 'Con error', count: 2 }];
    readonly value = signal('');
  }

  it('marca la elegida con aria-pressed, muestra el contador y cambia el valor', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const buttons = fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>;
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
    expect(buttons[1].textContent).toContain('2');
    buttons[1].click();
    fixture.detectChanges();
    expect(fixture.componentInstance.value()).toBe('ERROR');
    expect(buttons[1].getAttribute('aria-pressed')).toBe('true');
    expect(fixture.nativeElement.querySelector('[role="group"]').getAttribute('aria-label')).toBe('Estado');
  });
});

describe('BarChartComponent', () => {
  it('dibuja una barra apilada por día, con título accesible y tabla de datos', () => {
    const fixture = TestBed.createComponent(BarChartComponent);
    const data: IBarDatum[] = [{ label: '14/11', values: [3, 1] }, { label: '15/11', values: [0, 0] }];
    fixture.componentRef.setInput('title', 'Publicaciones por día');
    fixture.componentRef.setInput('series', [{ name: 'Publicadas', fill: 'fill-green-500' }, { name: 'Fallidas', fill: 'fill-red-500' }]);
    fixture.componentRef.setInput('data', data);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const svg = el.querySelector('svg[role="img"]')!;
    expect(svg.querySelector('title')?.textContent).toBe('Publicaciones por día');
    expect(svg.querySelector('desc')?.textContent).toContain('Publicadas: 3, Fallidas: 1');
    // Las barras a cero no pintan rectángulo.
    expect(svg.querySelectorAll('rect').length).toBe(2);
    expect(el.querySelectorAll('table tbody tr').length).toBe(2);
  });
});

describe('TemplateEditorComponent', () => {
  @Component({
    imports: [TemplateEditorComponent],
    template: `<ym-template-editor inputId="te" usage="REPLY" [blocks]="['redes']" [(value)]="text" />`
  })
  class Host {
    text = signal('Hola {nombre} #bloque:redes {titulo}');
  }

  function setup() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const field = el.querySelector('textarea') as HTMLTextAreaElement;
    const type = (value: string, caret = value.length) => {
      field.value = value;
      field.setSelectionRange(caret, caret);
      field.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    };
    const key = (k: string) => {
      field.dispatchEvent(new KeyboardEvent('keydown', { key: k, cancelable: true }));
      fixture.detectChanges();
    };
    return { fixture, el, field, type, key };
  }

  it('resalta las etiquetas y marca en rojo las que no valen para el uso', () => {
    const { el } = setup();
    const marks = Array.from(el.querySelectorAll('mark')).map(m => [m.textContent, m.className.includes('red') ? 'mal' : 'bien']);
    expect(marks).toEqual([['{nombre}', 'bien'], ['#bloque:redes', 'bien'], ['{titulo}', 'mal']]);
  });

  it('«{» abre el menú filtrado y Enter inserta la etiqueta en lugar de lo escrito', () => {
    const { fixture, el, field, type, key } = setup();
    type('Hola {nom');
    const options = Array.from(el.querySelectorAll('[role=option]')).map(o => o.querySelector('code')?.textContent);
    expect(options[0]).toBe('{nombre}');
    key('Enter');
    expect(field.value).toBe('Hola {nombre}');
    expect(fixture.componentInstance.text()).toBe('Hola {nombre}');
    expect(el.querySelector('[role=listbox]')).toBeNull();
  });

  it('Retroceso junto a una etiqueta la borra entera', () => {
    const { fixture, field, type, key } = setup();
    type('Hola {nombre}');
    key('Backspace');
    expect(fixture.componentInstance.text()).toBe('Hola ');
    expect(field.value).toBe('Hola ');
  });

  it('el botón «Campo a completar» inserta {?nombre} con un nombre válido', () => {
    const { fixture, el, type } = setup();
    type('Precio: ');
    const button = Array.from(el.querySelectorAll('button')).find(b => b.textContent?.includes('Campo a completar'))!;
    button.click();
    fixture.detectChanges();
    const name = el.querySelector('#te-field') as HTMLInputElement;
    name.value = 'precio';
    name.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.detectChanges();
    expect(fixture.componentInstance.text()).toBe('Precio: {?precio}');
  });
});
