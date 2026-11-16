import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom, map } from 'rxjs';
import { PLATFORM_META } from '@core/constants/status.constants';
import { GuidePlatform, IGuideFaq } from '@core/guides/guide.models';
import { GUIDES, GUIDE_PLATFORM, isGuidePlatform } from '@core/guides/guides';
import { ConnectionHttp, SettingsHttp } from '@core/http/api.http';
import { RulesService } from '@core/services/rules.service';
import { ToastService } from '@core/services/toast.service';
import { normalizeText } from '@core/utils/format';
import { readStored, writeStored } from '@core/utils/storage';
import { GuideShotComponent } from '@shared/guide-shot.component';
import { RichTextPipe } from '@shared/rich-text.pipe';
import { ChipComponent } from '@shared/ui/chip.component';
import { IconComponent } from '@shared/ui/icon.component';
import { ProgressBarComponent } from '@shared/ui/progress-bar.component';
import { copyText } from '@core/utils/clipboard';
import { toggled } from '@core/utils/selection';

@Component({
  selector: 'ym-guide-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, GuideShotComponent, RichTextPipe, ChipComponent, IconComponent, ProgressBarComponent],
  templateUrl: './guide.page.html'
})
export class GuidePage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly http = inject(ConnectionHttp);
  private readonly settingsHttp = inject(SettingsHttp);
  private readonly rules = inject(RulesService);
  private readonly toast = inject(ToastService);

  private readonly guidePlatform = toSignal(
    this.route.paramMap.pipe(map(p => {
      const value = p.get('platform');
      return isGuidePlatform(value) ? value : 'youtube';
    })),
    { initialValue: 'youtube' as GuidePlatform }
  );

  protected readonly guide = computed(() => GUIDES[this.guidePlatform()]);
  protected readonly platform = computed(() => GUIDE_PLATFORM[this.guidePlatform()]);
  protected readonly meta = computed(() => PLATFORM_META[this.platform()]);
  /** Pestañas: solo las guías de plataformas activas (una desactivada, como LinkedIn, no aparece). */
  protected readonly allGuides = computed(() => Object.values(GUIDES)
    .filter(g => this.rules.isEnabled(GUIDE_PLATFORM[g.platform]))
    .map(g => ({ platform: g.platform, meta: PLATFORM_META[GUIDE_PLATFORM[g.platform]] })));
  protected readonly vars = signal<Record<string, string>>({});
  protected readonly search = signal('');
  protected readonly openFaqs = signal<ReadonlySet<string>>(new Set());
  protected readonly done = signal<ReadonlySet<string>>(new Set());

  protected readonly doneCount = computed(() => this.guide().steps.filter(s => this.done().has(this.key(s.id))).length);

  /** Busca en pregunta, síntoma y respuesta; así pegar el mensaje de error encuentra la solución. */
  protected readonly faqs = computed(() => {
    const term = normalizeText(this.search());
    const all = this.guide().faqs;
    if (!term) return all;
    return all.filter(f => normalizeText([f.question, f.symptom ?? '', ...f.answer].join(' ')).includes(term));
  });

  ngOnInit(): void {
    this.done.set(readDone());
    void this.loadVars();

    // ?faq=id o ?step=id: llega desde un aviso o desde Conexiones y abre esa parte.
    this.route.queryParamMap.subscribe(params => {
      const faq = params.get('faq');
      const step = params.get('step');
      if (faq) this.openFaq(faq);
      else if (step) this.scrollTo(`step-${step}`);
    });
    this.route.fragment.subscribe(fragment => fragment && this.scrollTo(fragment));
  }

  protected stepNumber(id: string): number {
    return this.guide().steps.findIndex(s => s.id === id) + 1;
  }

  protected faqById(id: string): IGuideFaq | undefined {
    return this.guide().faqs.find(f => f.id === id);
  }

  protected isDone(stepId: string): boolean {
    return this.done().has(this.key(stepId));
  }

  protected toggleDone(stepId: string): void {
    const next = toggled(this.done(), this.key(stepId));
    this.done.set(next);
    saveDone(next);
  }

  protected resetProgress(): void {
    const prefix = `${this.guidePlatform()}:`;
    const next = new Set([...this.done()].filter(k => !k.startsWith(prefix)));
    this.done.set(next);
    saveDone(next);
  }

  protected toggleFaq(id: string): void {
    this.openFaqs.set(toggled(this.openFaqs(), id));
  }

  protected openFaq(id: string): void {
    this.search.set('');
    this.openFaqs.set(new Set([...this.openFaqs(), id]));
    this.scrollTo(`faq-${id}`);
  }

  protected scrollTo(elementId: string): void {
    setTimeout(() => document.getElementById(elementId)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  protected copy(text: string): Promise<void> {
    return copyText(this.toast, text);
  }

  private key(stepId: string): string {
    return `${this.guidePlatform()}:${stepId}`;
  }

  private async loadVars(): Promise<void> {
    void this.loadTeamsVars();
    try {
      const status = await firstValueFrom(this.http.status());
      this.vars.update(v => ({
        ...v,
        redirectUri: status.googleRedirectUri ?? '',
        tiktokRedirectUri: status.tiktokRedirectUri ?? '',
        linkedinRedirectUri: status.linkedinRedirectUri ?? '',
        linkedinOrgRedirectUri: status.linkedinOrgRedirectUri ?? '',
        teamsRedirectUri: status.teamsRedirectUri ?? '',
        graphVersion: status.graphVersion
      }));
    } catch {
      // La guía funciona sin estos valores; se muestran como «…».
    }
  }

  /**
   * De Ajustes: inquilino e Id. de la app de Teams (enlace de consentimiento para TI) y la URL del webhook de Meta con
   * su texto de verificación (bandeja).
   */
  private async loadTeamsVars(): Promise<void> {
    try {
      const { teams, metaApp } = await firstValueFrom(this.settingsHttp.platforms());
      this.vars.update(v => ({
        ...v,
        teamsTenantId: teams?.tenantId ?? '',
        teamsClientId: teams?.publicId ?? '',
        metaWebhookUrl: metaApp?.webhookUrl ?? '',
        metaVerifyToken: metaApp?.verifyToken ?? ''
      }));
    } catch {
      // Sin ajustes guardados el enlace sale con «…».
    }
  }
}

const STORAGE_KEY = 'ym.guide.done';

function readDone(): ReadonlySet<string> {
  return new Set(readStored<string[]>(STORAGE_KEY, []));
}

function saveDone(done: ReadonlySet<string>): void {
  writeStored(STORAGE_KEY, [...done]);
}
