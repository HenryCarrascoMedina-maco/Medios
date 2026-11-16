import { Directive, input, output } from '@angular/core';
import { IConnection, PostKind } from '@core/models/api.models';
import { IDraft } from './publish.models';

/** Entrada/salida común de los paneles de ajustes por plataforma del diálogo de publicación. */
@Directive()
export abstract class PlatformSettingsBase {
  readonly account = input.required<IConnection>();
  readonly draft = input.required<IDraft>();
  /** Tipo de la publicación (los textos de ayuda cambian entre video, imagen, texto…). */
  readonly kind = input<PostKind>('VIDEO');
  /** Cambios del borrador de esta cuenta; el diálogo los aplica. */
  readonly patch = output<Partial<IDraft>>();
}
