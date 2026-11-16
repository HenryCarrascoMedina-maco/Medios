/**
 * Dobles para las pruebas que MONTAN páginas enteras (TestBed sin servidor): cada servicio HTTP
 * devuelve datos mínimos válidos. Así un error de ejecución al crear la página (p. ej. NG0203 por
 * llamar a toObservable/effect fuera del contexto de inyección) aparece en `npm test`.
 * Solo lo importan los *.spec.ts.
 */
import { EnvironmentProviders, Provider, signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { EMPTY, NEVER, of } from 'rxjs';
import { ConnectionHttp, HomeHttp, InboxHttp, InsightsHttp, PublicationHttp, SettingsHttp, TemplateHttp, VideoHttp } from '@core/http/api.http';
import {
  IConnection, IConnectionsStatus, ICredentialSource, IHomeSummary, IInboxContact, IInboxConversation, IInboxMessage, IInboxRules, IInboxSettings, IPlatformCapability,
  IPlatformSettings, IPublication, IPublicationRules, ITemplate, IUsage, IVideo, Platform, PostKind
} from '@core/models/api.models';
import { CONNECT_PLATFORMS } from '@core/constants/status.constants';
import { ClockService } from '@core/services/clock.service';
import { EntityHubService } from '@core/services/entity-hub.service';
import { PosterService } from '@core/services/poster.service';
import { ToastService } from '@core/services/toast.service';
import { VideoUploadService } from '@core/services/video-upload.service';
import { DEFAULT_RULES } from '@core/utils/publication-rules';

export const video = (overrides: Partial<IVideo> = {}): IVideo => ({
  id: 1, title: 'Demo', originalFileName: 'demo.mp4', contentType: 'video/mp4', sizeBytes: 1024 * 1024, durationSec: 30,
  width: 1920, height: 1080, hasPoster: false, mediaKind: 'VIDEO', createdBy: 'admin', createdAt: '2026-11-15T10:00:00Z', tags: [], publications: [], ...overrides
});

/** Plantilla propia: por defecto, una respuesta «/envio» con un PDF adjunto. */
export const template = (overrides: Partial<ITemplate> = {}): ITemplate => ({
  id: 1, usage: 'REPLY', name: 'Envío', shortcut: 'envio', title: null, body: 'Hola {nombre}, el envío cuesta {?precio}.', tags: null, platforms: [],
  isDefault: false, useCount: 3, lastUsedAt: null, updatedAt: '2026-11-16T00:00:00Z',
  media: [{
    position: 0, mediaId: 21, altText: null, title: 'Tarifas', originalFileName: 'tarifas.pdf', contentType: 'application/pdf', sizeBytes: 40000,
    durationSec: null, width: null, height: null, mediaKind: 'DOCUMENT', hasPoster: false, missing: false, createdBy: 'admin', createdAt: '2026-11-01T00:00:00Z'
  }],
  ...overrides
});

export const publishTemplate = (overrides: Partial<ITemplate> = {}): ITemplate =>
  template({ id: 2, usage: 'PUBLISH', name: 'Lanzamiento', shortcut: null, title: '{titulo}', body: 'Nuevo video: {titulo} #bloque:redes', media: [], useCount: 0, ...overrides });

export const image = (id: number, overrides: Partial<IVideo> = {}): IVideo =>
  video({ id, title: `Imagen ${id}`, originalFileName: `i${id}.jpg`, contentType: 'image/jpeg', sizeBytes: 200 * 1024, durationSec: null, width: 1080, height: 1350, mediaKind: 'IMAGE', ...overrides });

export const pdf = (id: number, overrides: Partial<IVideo> = {}): IVideo =>
  video({ id, title: `Documento ${id}`, originalFileName: `d${id}.pdf`, contentType: 'application/pdf', sizeBytes: 500 * 1024, durationSec: null, width: null, height: null, mediaKind: 'DOCUMENT', ...overrides });

export const account = (platform: Platform, id = 1, overrides: Partial<IConnection> = {}): IConnection => ({
  id, platform, externalId: `ext-${id}`, displayName: `Cuenta ${id}`, alias: null, avatarUrl: null, accountHint: null, scopes: null, tokenExpiresAt: null,
  statusCode: 'CONNECTED', statusMessage: null, isDefault: false, credentialId: null, credentialName: null, uploadLimitMb: null,
  connectedBy: 'admin', connectedAt: '2026-11-01T10:00:00Z', lastUsedAt: null, lastTestAt: null, lastTestOk: null, lastTestMessage: null, revokedAt: null, ...overrides
});

const capability = (platform: Platform, kinds: PostKind[], extra: Partial<IPlatformCapability> = {}): IPlatformCapability => ({
  platform, kinds, maxImages: 10, imageMaxBytes: 8 * 1024 * 1024, imageTypes: ['image/jpeg', 'image/png'], imagesNeedPublicUrl: false,
  firstComment: false, textMax: null, documentMaxBytes: null, ...extra
});

/** Reglas como las que daría el servidor con LinkedIn, imágenes y primer comentario. */
export const SERVER_RULES: IPublicationRules = {
  ...DEFAULT_RULES,
  enabledPlatforms: [...CONNECT_PLATFORMS],
  publicMediaAvailable: false,
  platforms: {
    ...DEFAULT_RULES.platforms,
    YOUTUBE: capability('YOUTUBE', ['VIDEO'], { maxImages: 0, imageTypes: [] }),
    FACEBOOK: capability('FACEBOOK', ['TEXT', 'LINK', 'IMAGE', 'CAROUSEL', 'VIDEO'], { firstComment: true }),
    INSTAGRAM: capability('INSTAGRAM', ['IMAGE', 'CAROUSEL', 'VIDEO'], { imageTypes: ['image/jpeg'], imagesNeedPublicUrl: true, firstComment: true }),
    TELEGRAM: capability('TELEGRAM', ['TEXT', 'LINK', 'IMAGE', 'CAROUSEL', 'VIDEO', 'DOCUMENT'], { textMax: 4096, documentMaxBytes: 50 * 1024 * 1024 }),
    TIKTOK: capability('TIKTOK', ['IMAGE', 'CAROUSEL', 'VIDEO'], { maxImages: 35, imageTypes: ['image/jpeg'], imagesNeedPublicUrl: true }),
    LINKEDIN: capability('LINKEDIN', ['TEXT', 'LINK', 'IMAGE', 'CAROUSEL', 'VIDEO', 'DOCUMENT'], { maxImages: 20, firstComment: true, textMax: 3000, documentMaxBytes: 100 * 1024 * 1024 }),
    TEAMS: capability('TEAMS', ['TEXT', 'LINK', 'IMAGE', 'CAROUSEL', 'VIDEO', 'DOCUMENT'], { imageMaxBytes: 20 * 1024 * 1024, firstComment: true, textMax: 20000, documentMaxBytes: 250 * 1024 * 1024 })
  },
  teamsWebhook: capability('TEAMS', ['TEXT', 'LINK', 'IMAGE', 'CAROUSEL'], { imageMaxBytes: 20 * 1024 * 1024, imagesNeedPublicUrl: true, textMax: 20000 })
};

export const publication = (overrides: Partial<IPublication> = {}): IPublication => ({
  id: 10, videoId: 1, videoTitle: 'Demo', postId: 5, postKind: 'VIDEO', mediaCount: 1, commentPending: false, target: 'LINKEDIN', connectionId: 1,
  connectionName: 'Henry', connectionAvatarUrl: null, title: 'Demo', privacyStatus: 'public', publishAt: null, statusCode: 'DONE', percent: null,
  bytesSent: null, totalBytes: null, externalUrl: null, warning: null, errorCode: null, errorMessage: null, attempts: 1, maxAttempts: 5,
  nextAttemptAt: null, isSending: false, requestedBy: 'admin', requestedAt: '2026-11-15T09:00:00Z', updatedAt: null, ...overrides
});

const source = (publicId: string | null = null): ICredentialSource =>
  ({ source: publicId ? 'DATABASE' : 'NONE', credentialId: publicId ? 1 : null, publicId, redirectUri: 'https://api.test/cb', updatedAt: null });

export const platformSettings = (): IPlatformSettings => ({
  google: source('g.apps.googleusercontent.com'), tiktok: source(), linkedin: source('86ab'), linkedinOrg: source(),
  teams: { ...source('1a2b3c4d-0000-0000-0000-000000000001'), tenantId: '9f8e7d6c-0000-0000-0000-000000000002', secretExpiresAt: '2028-11-15' },
  metaApp: { ...source('123456789012345'), redirectUri: null, webhookUrl: 'https://api.test/api/Webhook/Meta', verifyToken: 'abc123' }, telegramBots: []
});

export const conversation = (overrides: Partial<IInboxConversation> = {}): IInboxConversation => ({
  id: 1, connectionId: 1, platform: 'WHATSAPP', accountName: 'Ventas', accountAvatarUrl: null, kind: 'DIRECT', externalId: '51999', title: 'Lucía Pérez',
  link: null, statusCode: 'OPEN', unreadCount: 2, lastMessageAt: '2026-11-16T10:42:00Z', lastMessagePreview: '¿Tienen envío a Cusco?',
  lastInboundAt: '2026-11-16T10:42:00Z', awaitingSince: '2026-11-16T10:38:00Z', assignedTo: null, publicationId: null, videoId: null, contactId: 7,
  contactName: 'Lucía Pérez', contactHandle: '+51999', contactAvatarUrl: null, windowExpiresAt: null, tags: [], ...overrides
});

/** Contacto de la agenda (alta a mano, sin cuenta en una red todavía). */
export const agendaContact = (overrides: Partial<IInboxContact> = {}): IInboxContact => ({
  id: 20, platform: 'AGENDA', externalId: 'a-20', displayName: 'Juan Pérez', handle: '+51987654321', avatarUrl: null, personId: null,
  phone: '+51987654321', email: 'juan@empresa.com', createdAt: '2026-11-16T00:00:00Z', conversations: 0, lastConversationId: null, ...overrides
});

export const inboxMessage = (overrides: Partial<IInboxMessage> = {}): IInboxMessage => ({
  id: 1, conversationId: 1, externalId: 'wamid.1', parentExternalId: null, direction: 'IN', authorName: 'Lucía Pérez', authorExternalId: '51999',
  body: '¿Tienen envío a Cusco?', sentAt: '2026-11-16T10:42:00Z', statusCode: 'RECEIVED', errorMessage: null, attempts: 0, createdBy: null,
  attachments: [], template: null, privateReply: false, ...overrides
});

/** Reglas de la bandeja como las da el servidor (InboxRules.cs). */
export const INBOX_RULES: IInboxRules = {
  capabilities: {
    'WHATSAPP:DIRECT': { textMax: 4096, windowHours: 24, attachments: true, attachmentsNeedPublicUrl: false, privateReply: false, templates: true, quotaUnits: 0 },
    'FACEBOOK:COMMENTS': { textMax: 8000, windowHours: null, attachments: false, attachmentsNeedPublicUrl: false, privateReply: true, templates: false, quotaUnits: 0 },
    'YOUTUBE:COMMENTS': { textMax: 10000, windowHours: null, attachments: false, attachmentsNeedPublicUrl: false, privateReply: false, templates: false, quotaUnits: 50 },
    'TELEGRAM:DIRECT': { textMax: 4096, windowHours: null, attachments: true, attachmentsNeedPublicUrl: false, privateReply: false, templates: false, quotaUnits: 0 }
  },
  windowHours: 24, humanAgentDays: null, publicMediaAvailable: false, youtubeReplyUnits: 50, noteMax: 4000
};

export const inboxSettings = (): IInboxSettings => ({
  accounts: [
    { id: 1, platform: 'WHATSAPP', name: 'Ventas', avatarUrl: null, accountHint: '+51 999', statusCode: 'CONNECTED', credentialName: null, inboxDirect: true,
      inboxComments: false, supportsDirect: true, supportsComments: false, mode: 'WEBHOOK', problem: null, fix: null, lastOkAt: null, lastError: null,
      lastInboundAt: '2026-11-16T10:42:00Z', openConversations: 1 },
    { id: 2, platform: 'YOUTUBE', name: 'Kaltrum', avatarUrl: null, accountHint: '@kaltrum', statusCode: 'CONNECTED', credentialName: null, inboxDirect: false,
      inboxComments: true, supportsDirect: false, supportsComments: true, mode: 'POLL',
      problem: 'Falta el permiso para leer y responder comentarios. Vuelve a conectar el canal (una sola vez).', fix: 'RECONNECT',
      lastOkAt: null, lastError: null, lastInboundAt: null, openConversations: 0 }
  ],
  publicUrlConfigured: false, metaWebhookUrl: null, metaVerifyToken: 'abc123', metaAppConfigured: true, humanAgentEnabled: false, retentionMonths: 12
});

export const homeSummary = (): IHomeSummary => ({
  kpis: { awaiting: 3, windowsClosing: 1, avgResponseMinutes: 38, avgResponseMinutesPrevious: 50, publishedToday: 5, scheduledToday: 2, failedRecent: 1,
    connections: 9, connectionsAttention: 2 },
  urgent: [conversation()],
  agenda: [{ id: 3, videoId: null, title: 'Promo noviembre', target: 'FACEBOOK', connectionName: 'Kaltrum', statusCode: 'PENDING', at: '2026-11-16T19:30:00Z', isProblem: false }],
  activity: Array.from({ length: 7 }, (_, i) => ({ day: `2026-11-${10 + i}T00:00:00Z`, received: i, published: 1 }))
});

export const connectionsStatus = (accounts: IConnection[] = []): IConnectionsStatus => ({
  googleConfigured: true, googleRedirectUri: 'https://api.test/yt', tiktokConfigured: false, tiktokRedirectUri: null,
  linkedinConfigured: true, linkedinRedirectUri: 'https://api.test/li', linkedinOrgConfigured: false, linkedinOrgRedirectUri: 'https://api.test/li-org',
  teamsConfigured: true, teamsRedirectUri: 'https://api.test/teams',
  telegramBots: 0, graphVersion: 'v24.0', accounts, history: []
});

const usage: IUsage = {
  dayPt: '2026-11-15', uploads: 0, uploadsLimit: 6, units: 0, unitsLimit: 10000, resetsAtUtc: '2026-11-16T08:00:00Z', channels: [],
  storageRoot: 'D:\\media', storageUsedBytes: 0, storageFreeBytes: 1024
};

export interface IPageMockData {
  videos?: IVideo[];
  publications?: IPublication[];
  accounts?: IConnection[];
}

/** Proveedores comunes para montar cualquier página sin servidor. */
export function pageProviders(data: IPageMockData = {}): (Provider | EnvironmentProviders)[] {
  const videos = data.videos ?? [video()];
  const accounts = data.accounts ?? [account('LINKEDIN')];
  return [
    provideRouter([]),
    {
      provide: VideoHttp,
      useValue: {
        tusEndpoint: '/api/Video/tus',
        page: jest.fn(() => of({ items: videos, total: videos.length })),
        list: jest.fn(() => of(videos)),
        get: jest.fn(() => of(videos[0])),
        tags: jest.fn(() => of([])),
        poster: jest.fn(() => NEVER),
        tusConfig: jest.fn(() => of({ ttlMinutes: 60, maxUploadBytes: 1e10, allowedExtensions: ['mp4', 'jpg', 'jpeg', 'png', 'pdf'] }))
      }
    },
    {
      provide: PublicationHttp,
      useValue: {
        list: jest.fn(() => of(data.publications ?? [publication()])),
        rules: jest.fn(() => of(SERVER_RULES)),
        calendar: jest.fn(() => of([])),
        events: jest.fn(() => of([])),
        notifications: jest.fn(() => of([])),
        create: jest.fn(() => of([{ connectionId: 1, accountName: 'Henry', publicationId: 99, error: null }])),
        retryComment: jest.fn(() => of(null)),
        retry: jest.fn(() => of(null)),
        cancel: jest.fn(() => of(null))
      }
    },
    {
      provide: ConnectionHttp,
      useValue: {
        status: jest.fn(() => of(connectionsStatus(accounts))),
        usage: jest.fn(() => of(usage)),
        youtubeCategories: jest.fn(() => of([{ id: '26', title: 'Consejos' }])),
        youtubePlaylists: jest.fn(() => of([])),
        tiktokCreatorInfo: jest.fn(() => NEVER),
        oauthUrl: jest.fn(() => NEVER),
        teamsChannels: jest.fn(() => of({
          account: { name: 'Henry', email: 'henry@kaltrum.com' },
          teams: [{ id: 't1', name: 'Marketing', channels: [
            { id: 'c1', name: 'General', membershipType: 'standard', connected: true },
            { id: 'c2', name: 'Lanzamientos', membershipType: 'standard', connected: false },
            { id: 'c3', name: 'Diseño', membershipType: 'private', connected: false }
          ] }]
        })),
        teamsSave: jest.fn(() => of([{ name: 'Marketing › Lanzamientos', connectionId: 9, isNew: true, error: null }])),
        teamsWebhook: jest.fn(() => of(10))
      }
    },
    { provide: SettingsHttp, useValue: { platforms: jest.fn(() => of(platformSettings())), save: jest.fn(() => of(1)), delete: jest.fn(() => of('')) } },
    {
      provide: TemplateHttp,
      useValue: {
        list: jest.fn(() => of([template(), publishTemplate()])),
        blocks: jest.fn(() => of([{ id: 1, name: 'redes', content: '#kaltrum #tienda' }])),
        save: jest.fn(() => of(3)),
        delete: jest.fn(() => of(null)),
        used: jest.fn(() => of(null)),
        saveBlock: jest.fn(() => of(null)),
        deleteBlock: jest.fn(() => of(null))
      }
    },
    { provide: InsightsHttp, useValue: { get: jest.fn(() => NEVER), health: jest.fn(() => NEVER) } },
    {
      provide: InboxHttp,
      useValue: {
        conversations: jest.fn(() => of([conversation()])),
        conversation: jest.fn(() => of(conversation())),
        update: jest.fn((_id: number, changes: Partial<IInboxConversation>) => of(conversation({ ...changes, unreadCount: 0 }))),
        counts: jest.fn(() => of({ open: 1, pending: 0, closed: 0, unread: 1, awaiting: 1 })),
        messages: jest.fn(() => of([inboxMessage()])),
        send: jest.fn(() => of(inboxMessage({ id: 2, direction: 'OUT', statusCode: 'QUEUED', body: 'Sí, enviamos' }))),
        resolve: jest.fn(() => of(inboxMessage())),
        templates: jest.fn(() => of([])),
        contact: jest.fn(() => of({ contact: { id: 7, platform: 'WHATSAPP', externalId: '51999', displayName: 'Lucía Pérez', handle: '+51999', avatarUrl: null,
          personId: null, createdAt: '2026-10-01T00:00:00Z', conversations: 1, lastConversationId: 1 }, linked: [] })),
        searchContacts: jest.fn(() => of([])),
        createContact: jest.fn(() => of({ contact: agendaContact(), linked: [], invites: [] })),
        startConversation: jest.fn(() => of(conversation({ id: 5, lastInboundAt: null, windowNeverOpened: true }))),
        createInvite: jest.fn((connectionId: number, contactId: number) => of({ id: 1, code: 'inv0011', contactId, connectionId, platform: 'TELEGRAM',
          accountName: 'Soporte', link: 'https://t.me/kaltrum_bot?start=inv0011', expiresAt: '2026-12-16T00:00:00Z', usedAt: null, createdBy: 'admin',
          createdAt: '2026-11-16T00:00:00Z' })),
        rules: jest.fn(() => of(INBOX_RULES)),
        settings: jest.fn(() => of(inboxSettings())),
        saveAccount: jest.fn(() => of(inboxSettings().accounts[0])),
        prepareAccount: jest.fn(() => of(inboxSettings().accounts[0]))
      }
    },
    { provide: HomeHttp, useValue: { summary: jest.fn(() => of(homeSummary())) } },
    {
      provide: EntityHubService,
      useValue: { on: () => EMPTY, publishUpdates: () => EMPTY, reconnected$: EMPTY, entityUpdate$: EMPTY, connected: signal(true), start: jest.fn(), stop: jest.fn() }
    },
    { provide: PosterService, useValue: { get: () => Promise.resolve(null), revision: signal(0), refresh: jest.fn(), forget: jest.fn() } },
    // Sin temporizadores: el reloj (setInterval) y los avisos (setTimeout) impedirían que whenStable termine.
    { provide: ClockService, useValue: { now: signal(Date.now()) } },
    { provide: ToastService, useValue: { success: jest.fn(), error: jest.fn(), warning: jest.fn(), info: jest.fn(), toasts: signal([]) } },
    { provide: VideoUploadService, useValue: { uploads: signal([]), active: signal([]), busy: signal(false), completed$: EMPTY, add: jest.fn() } }
  ];
}
