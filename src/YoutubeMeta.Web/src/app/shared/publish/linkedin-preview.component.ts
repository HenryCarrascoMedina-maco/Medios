import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { IConnection, IVideo, PostKind, PrivacyStatus } from '@core/models/api.models';
import { AccountAvatarComponent } from '@shared/ui/account-avatar.component';
import { IconComponent } from '@shared/ui/icon.component';
import { PostMediaComponent } from './post-media.component';
import { LINKEDIN_FOLD, foldText } from './publish.models';

/**
 * Vista previa de un post de LinkedIn: autor, texto cortado donde LinkedIn pone «…ver más», los
 * medios (cuadrícula de imágenes, video, PDF o enlace) y la barra de acciones.
 */
@Component({
  selector: 'ym-linkedin-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AccountAvatarComponent, IconComponent, PostMediaComponent],
  host: { class: 'block' },
  template: `
    @let a = account();
    <div class="max-w-xs overflow-hidden rounded-lg border border-line bg-surface text-xs">
      <div class="flex items-center gap-2 p-2">
        <ym-account-avatar [platform]="a.platform" [name]="name()" [url]="a.avatarUrl" [size]="32" [badge]="false" />
        <div class="min-w-0">
          <b class="block truncate text-[13px]">{{ name() }}</b>
          <span class="flex items-center gap-1 text-[10px] muted">Ahora · <ym-icon [name]="privacy() === 'connections' ? 'heart' : 'broadcast'" [size]="10" [label]="privacy() === 'connections' ? 'Solo mis contactos' : 'Cualquiera'" /></span>
        </div>
      </div>
      @if (text()) {
        <p class="whitespace-pre-line px-2 pb-2">{{ folded().shown }}@if (folded().more) {<span class="muted">… <b>ver más</b></span>}</p>
      }
      @if (title() && (kind() === 'DOCUMENT' || kind() === 'VIDEO')) { <b class="block px-2 pb-1 text-[12px]">{{ title() }}</b> }
      <ym-post-media [media]="media()" [kind]="kind()" [linkUrl]="linkUrl()" [max]="4" />
      <div class="flex justify-around border-t border-line px-1 py-1.5 text-[10px] muted">
        <span>Recomendar</span><span>Comentar</span><span>Compartir</span><span>Enviar</span>
      </div>
    </div>
    @if (folded().more) { <p class="mt-1 text-[11px] muted">LinkedIn corta el texto a unos {{ fold }} caracteres con «…ver más»: lo importante, al principio.</p> }
  `
})
export class LinkedinPreviewComponent {
  readonly account = input.required<IConnection>();
  readonly text = input('');
  readonly title = input('');
  readonly media = input<readonly IVideo[]>([]);
  readonly kind = input.required<PostKind>();
  readonly linkUrl = input('');
  readonly privacy = input<PrivacyStatus | null>('public');

  protected readonly fold = LINKEDIN_FOLD;
  protected readonly name = computed(() => this.account().alias ?? this.account().displayName);
  protected readonly folded = computed(() => foldText(this.text(), LINKEDIN_FOLD));
}
