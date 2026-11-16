import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { PLATFORM_META } from '@core/constants/status.constants';
import { IConnection, IVideo, PostKind, PrivacyStatus } from '@core/models/api.models';
import { RulesService } from '@core/services/rules.service';
import { formatDuration } from '@core/utils/format';
import { telegramCaption, textLimits } from '@core/utils/publication-rules';
import { truncateText } from '@core/utils/template-vars';
import { PosterComponent } from '@shared/poster.component';
import { AccountAvatarComponent } from '@shared/ui/account-avatar.component';
import { IconComponent } from '@shared/ui/icon.component';
import { MediaThumbComponent } from '@shared/ui/media-thumb.component';
import { LinkedinPreviewComponent } from './linkedin-preview.component';
import { PostMediaComponent } from './post-media.component';

/** Lo que se ve en el feed antes de «ver más» (aprox.), además del límite duro de la plataforma. */
const FOLD: Record<string, number> = { YOUTUBE: 160, FACEBOOK: 240, INSTAGRAM: 125, TELEGRAM: 4096, TIKTOK: 150 };

/** Vista previa aproximada en cada plataforma, con el texto recortado a sus límites y a lo que se ve en el feed. */
@Component({
  selector: 'ym-publish-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, PosterComponent, AccountAvatarComponent, IconComponent, MediaThumbComponent, LinkedinPreviewComponent, PostMediaComponent],
  host: { class: 'block' },
  template: `
    @let a = account();
    @let v = video();
    <div class="mb-1 text-[11px] font-semibold uppercase tracking-wide muted">Vista previa · {{ meta().label }}</div>
    @switch (a.platform) {
      @case ('YOUTUBE') {
        <div class="max-w-xs overflow-hidden rounded-lg border border-line bg-surface">
          @if (v) { <ym-poster [videoId]="v.id" [hasPoster]="v.hasPoster" [durationSec]="v.durationSec" [width]="v.width" [height]="v.height" [showPlay]="false" /> }
          <div class="flex gap-2 p-2">
            <ym-account-avatar [platform]="a.platform" [name]="name()" [url]="a.avatarUrl" [size]="28" [badge]="false" />
            <div class="min-w-0 text-xs">
              <b class="line-clamp-2 block text-[13px] leading-snug">{{ shownTitle() }}</b>
              <span class="muted">{{ name() }}</span>
              <p class="mt-1 line-clamp-3 whitespace-pre-line muted">{{ shownDescription() }}</p>
            </div>
          </div>
        </div>
      }
      @case ('INSTAGRAM') { <ng-container [ngTemplateOutlet]="v ? vertical : square" /> }
      @case ('TIKTOK') { <ng-container [ngTemplateOutlet]="v ? vertical : square" /> }
      @case ('TELEGRAM') {
        <div class="max-w-xs rounded-2xl rounded-bl-sm bg-sky-50 p-1.5 text-xs dark:bg-sky-500/10">
          @if (media().length) { <div class="overflow-hidden rounded-xl"><ym-post-media [media]="media()" [kind]="kind()" [max]="10" /></div> }
          <p class="whitespace-pre-line px-1.5 pt-1.5">{{ shownDescription() }}</p>
          @if (kind() === 'LINK') { <ym-post-media class="overflow-hidden rounded-xl" [kind]="kind()" [linkUrl]="linkUrl()" /> }
          <div class="px-1.5 text-right text-[10px] muted">{{ name() }}</div>
        </div>
      }
      @case ('LINKEDIN') {
        <ym-linkedin-preview [account]="a" [text]="body()" [title]="title()" [media]="media()" [kind]="kind()" [linkUrl]="linkUrl()" [privacy]="privacy()" />
      }
      @case ('TEAMS') {
        <div class="max-w-xs overflow-hidden rounded-lg border border-line bg-surface text-xs">
          <div class="flex items-center gap-1.5 border-b border-line px-2 py-1.5 font-semibold"><ym-icon name="teams" [size]="12" class="text-teams" /> {{ name() }}</div>
          <div class="border-l-2 border-teams p-2">
            @if (shownTitle()) { <b class="block text-[13px]">{{ shownTitle() }}</b> }
            <p class="whitespace-pre-line">{{ shownDescription() }}</p>
          </div>
          <ym-post-media [media]="media()" [kind]="kind()" [linkUrl]="linkUrl()" />
        </div>
      }
      @default {
        <div class="max-w-xs overflow-hidden rounded-lg border border-line bg-surface text-xs">
          <div class="flex items-center gap-2 p-2">
            <ym-account-avatar [platform]="a.platform" [name]="name()" [url]="a.avatarUrl" [size]="28" [badge]="false" />
            <b>{{ name() }}</b>
          </div>
          <p class="whitespace-pre-line px-2 pb-2">{{ shownDescription() }}</p>
          <ym-post-media [media]="media()" [kind]="kind()" [linkUrl]="linkUrl()" />
          @if (v) { <b class="block p-2 text-[13px]">{{ shownTitle() }}</b> }
        </div>
      }
    }
    @if (truncated()) { <p class="mt-1 text-[11px] text-amber-600 dark:text-amber-400">El texto supera el límite de {{ meta().label }}: se ve recortado.</p> }

    <ng-template #vertical>
      @if (v) {
        <div class="relative aspect-[9/16] w-40 overflow-hidden rounded-xl bg-black text-white">
          <ym-poster class="absolute inset-0 grid place-items-center" [videoId]="v.id" [hasPoster]="v.hasPoster" [showPlay]="false" />
          <div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2 text-[10px]">
            <b class="flex items-center gap-1"><ym-icon [name]="meta().icon" [size]="10" /> {{ name() }}</b>
            <p class="line-clamp-3 whitespace-pre-line">{{ a.platform === 'TIKTOK' ? shownTitle() : shownDescription() }}</p>
            <span class="opacity-70">{{ duration() }}</span>
          </div>
        </div>
      }
    </ng-template>

    <ng-template #square>
      <div class="w-56 overflow-hidden rounded-lg border border-line bg-surface text-xs">
        <div class="flex items-center gap-2 p-2">
          <ym-account-avatar [platform]="a.platform" [name]="name()" [url]="a.avatarUrl" [size]="24" [badge]="false" />
          <b>{{ name() }}</b>
        </div>
        @if (media().length) {
          <div class="relative">
            <ym-media-thumb [media]="media()[0]" [showPlay]="false" />
            @if (media().length > 1) { <span class="absolute right-1.5 top-1.5 rounded-full bg-black/60 px-1.5 text-[10px] text-white">1/{{ media().length }}</span> }
          </div>
        }
        <p class="line-clamp-3 whitespace-pre-line p-2"><b>{{ name() }}</b> {{ a.platform === 'TIKTOK' ? shownTitle() : shownDescription() }}</p>
      </div>
    </ng-template>
  `
})
export class PublishPreviewComponent {
  private readonly rules = inject(RulesService);

  readonly account = input.required<IConnection>();
  readonly media = input<readonly IVideo[]>([]);
  readonly kind = input<PostKind>('VIDEO');
  readonly linkUrl = input('');
  /** Texto con variables y bloques ya resueltos. */
  readonly title = input('');
  readonly description = input('');
  /** LinkedIn: «Cualquiera» o «Solo mis contactos». */
  readonly privacy = input<PrivacyStatus | null>(null);

  protected readonly video = computed(() => (this.kind() === 'VIDEO' ? this.media()[0] ?? null : null));
  protected readonly meta = computed(() => PLATFORM_META[this.account().platform]);
  protected readonly name = computed(() => this.account().alias ?? this.account().displayName);
  protected readonly duration = computed(() => formatDuration(this.video()?.durationSec ?? null));
  private readonly limits = computed(() => textLimits(this.account().platform, this.rules.rules(), this.kind() === 'TEXT' || this.kind() === 'LINK'));
  /** Telegram usa el título si la descripción está vacía. */
  protected readonly body = computed(() => (this.account().platform === 'TELEGRAM' ? telegramCaption(this.title(), this.description()) : this.description()));

  protected readonly shownTitle = computed(() => truncateText(this.title(), this.limits().title));
  protected readonly shownDescription = computed(() =>
    truncateText(truncateText(this.body(), this.limits().description), FOLD[this.account().platform] ?? 200));
  protected readonly truncated = computed(() => this.title().length > this.limits().title || this.body().length > this.limits().description);
}
