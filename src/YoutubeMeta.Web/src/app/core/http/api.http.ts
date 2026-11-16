import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  IAccountSaveResult,
  IBulkResult,
  ICalendarItem,
  IHealth,
  IInsights,
  IPage,
  IPlaylist,
  IPublicationQuery,
  IPublicationRules,
  ITagCount,
  ITemplate,
  ITemplateSave,
  ITextBlock,
  IVideoQuery,
  ResolveAction,
  ICategory,
  IConnectionTest,
  IConnectionsStatus,
  ICredentialSave,
  ICustomGenericResponse,
  IHomeSummary,
  IInboxAccount,
  IInboxContact,
  IContactCreate,
  IConversationStart,
  IInboxContactDetail,
  IInboxConversation,
  IInboxConversationQuery,
  IInboxInvite,
  IInboxCounts,
  IInboxMessage,
  IInboxReply,
  IInboxRules,
  IInboxSettings,
  InboxResolveAction,
  InboxStatus,
  IWhatsAppTemplate,
  ILoginResponse,
  IMetaAccountOption,
  INotification,
  IPlatformSettings,
  IPublication,
  IPublicationCreate,
  IPublicationCreateResult,
  IPublicationEvent,
  ITeamsChannelTree,
  ITelegramChat,
  ITiktokCreatorInfo,
  ITusConfig,
  IUsage,
  IVideo
} from '../models/api.models';

const api = environment.apiUrl;

/** Plataformas que se conectan con OAuth (segmento de /api/Connection/{plataforma}/Connect). */
export type OAuthPlatform = 'Youtube' | 'Tiktok' | 'Linkedin' | 'LinkedinOrg' | 'Teams';
/** Plataformas que se conectan con el token del usuario del sistema de Meta. */
export type MetaPlatform = 'Facebook' | 'Instagram' | 'WhatsApp';
const unwrap = <T>() => map((response: ICustomGenericResponse<T>) => response.data as T);

/** Parámetros de consulta quitando los vacíos (undefined, null o ''). */
export function toParams(query: object): HttpParams {
  let params = new HttpParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params = params.set(key, String(value));
  }
  return params;
}

@Injectable({ providedIn: 'root' })
export class AuthHttp {
  private readonly http = inject(HttpClient);

  login(userName: string, password: string): Observable<ILoginResponse> {
    return this.http.post<ICustomGenericResponse<ILoginResponse>>(`${api}/Auth/Login`, { userName, password }).pipe(unwrap());
  }

  /** Renueva el token vigente (Bearer) sin pedir la contraseña. Misma respuesta que Login. */
  refresh(): Observable<ILoginResponse> {
    return this.http.post<ICustomGenericResponse<ILoginResponse>>(`${api}/Auth/Refresh`, null).pipe(unwrap());
  }
}

@Injectable({ providedIn: 'root' })
export class VideoHttp {
  private readonly http = inject(HttpClient);

  readonly tusEndpoint = `${api}/Video/tus`;

  list(searchTerm?: string): Observable<IVideo[]> {
    const params = searchTerm ? new HttpParams().set('searchTerm', searchTerm) : undefined;
    return this.http.get<ICustomGenericResponse<IVideo[]>>(`${api}/Video`, { params }).pipe(unwrap());
  }

  get(id: number): Observable<IVideo> {
    return this.http.get<ICustomGenericResponse<IVideo>>(`${api}/Video/${id}`).pipe(unwrap());
  }

  /** Biblioteca paginada en el servidor, con filtros y orden. */
  page(query: IVideoQuery): Observable<IPage<IVideo>> {
    return this.http.get<ICustomGenericResponse<IPage<IVideo>>>(`${api}/Video/Page`, { params: toParams(query) }).pipe(unwrap());
  }

  tags(): Observable<ITagCount[]> {
    return this.http.get<ICustomGenericResponse<ITagCount[]>>(`${api}/Video/Tags`).pipe(unwrap());
  }

  /** Añade y quita etiquetas a varios videos; devuelve cuántos cambiaron. */
  updateTags(videoIds: number[], add: string[], remove: string[]): Observable<number> {
    return this.http.post<ICustomGenericResponse<number>>(`${api}/Video/Tags`, { videoIds, add, remove }).pipe(unwrap());
  }

  deleteMany(videoIds: number[]): Observable<IBulkResult> {
    return this.http.post<ICustomGenericResponse<IBulkResult>>(`${api}/Video/DeleteMany`, { videoIds }).pipe(unwrap());
  }

  /** Nueva miniatura (JPEG ≤ 2 MB) para un video ya subido. */
  replacePoster(id: number, poster: Blob): Observable<IVideo> {
    const form = new FormData();
    form.append('file', poster, 'poster.jpg');
    return this.http.post<ICustomGenericResponse<IVideo>>(`${api}/Video/${id}/Poster`, form).pipe(unwrap());
  }

  updateTitle(id: number, title: string): Observable<IVideo> {
    return this.http.put<ICustomGenericResponse<IVideo>>(`${api}/Video/${id}/Title`, { title }).pipe(unwrap());
  }

  delete(id: number): Observable<boolean> {
    return this.http.delete<ICustomGenericResponse<boolean>>(`${api}/Video/${id}`).pipe(unwrap());
  }

  /** `version` evita la caché del navegador tras cambiar la miniatura (misma URL). */
  poster(id: number, version = 0): Observable<Blob> {
    const params = version ? { v: version } : undefined;
    return this.http.get(`${api}/Video/${id}/Poster`, { responseType: 'blob', params });
  }

  uploadPoster(poster: Blob): Observable<string> {
    const form = new FormData();
    form.append('file', poster, 'poster.jpg');
    return this.http.post<ICustomGenericResponse<{ posterId: string }>>(`${api}/Video/Poster`, form).pipe(map(r => r.data!.posterId));
  }

  /** URL relativa con ticket: el <video> la usa para pedir el archivo por partes (Range). */
  streamUrl(id: number): Observable<string> {
    return this.http.post<ICustomGenericResponse<{ url: string }>>(`${api}/Video/${id}/stream-ticket`, null).pipe(map(r => `/${r.data!.url}`));
  }

  tusConfig(): Observable<ITusConfig> {
    return this.http.get<ICustomGenericResponse<ITusConfig>>(`${this.tusEndpoint}/config`).pipe(unwrap());
  }
}

@Injectable({ providedIn: 'root' })
export class PublicationHttp {
  private readonly http = inject(HttpClient);

  list(query: IPublicationQuery = {}): Observable<IPublication[]> {
    return this.http.get<ICustomGenericResponse<IPublication[]>>(`${api}/Publication`, { params: toParams(query) }).pipe(unwrap());
  }

  /** CSV con los mismos filtros que list(). Lleva token: se pide como blob. */
  exportCsv(query: IPublicationQuery = {}): Observable<Blob> {
    return this.http.get(`${api}/Publication/Export`, { params: toParams(query), responseType: 'blob' });
  }

  rules(): Observable<IPublicationRules> {
    return this.http.get<ICustomGenericResponse<IPublicationRules>>(`${api}/Publication/Rules`).pipe(unwrap());
  }

  /** Publicaciones entre dos fechas (máximo 62 días). */
  calendar(from: string, to: string): Observable<ICalendarItem[]> {
    return this.http.get<ICustomGenericResponse<ICalendarItem[]>>(`${api}/Publication/Calendar`, { params: { from, to } }).pipe(unwrap());
  }

  reschedule(id: number, publishAt: string | null): Observable<ICalendarItem> {
    return this.http.post<ICustomGenericResponse<ICalendarItem>>(`${api}/Publication/${id}/Reschedule`, { publishAt }).pipe(unwrap());
  }

  /** NEEDS_REVIEW: «ya está publicado» (con enlace opcional) o «publicar de nuevo». */
  resolve(id: number, action: ResolveAction, externalUrl?: string | null): Observable<unknown> {
    return this.http.post(`${api}/Publication/${id}/Resolve`, { action, externalUrl: externalUrl || null });
  }

  events(videoId: number): Observable<IPublicationEvent[]> {
    return this.http.get<ICustomGenericResponse<IPublicationEvent[]>>(`${api}/Publication/Events`, { params: { videoId } }).pipe(unwrap());
  }

  /** Encola el video en cada cuenta elegida; el resultado dice cuáles entraron. */
  create(request: IPublicationCreate): Observable<IPublicationCreateResult[]> {
    return this.http.post<ICustomGenericResponse<IPublicationCreateResult[]>>(`${api}/Publication`, request).pipe(unwrap());
  }

  retry(id: number): Observable<unknown> {
    return this.http.post(`${api}/Publication/${id}/Retry`, null);
  }

  cancel(id: number): Observable<unknown> {
    return this.http.post(`${api}/Publication/${id}/Cancel`, null);
  }

  /** Vuelve a poner solo el primer comentario (la publicación ya está hecha). */
  retryComment(id: number): Observable<unknown> {
    return this.http.post(`${api}/Publication/${id}/Comment`, null);
  }

  notifications(): Observable<INotification[]> {
    return this.http.get<ICustomGenericResponse<INotification[]>>(`${api}/Publication/Notifications`).pipe(unwrap());
  }

  notificationsRead(): Observable<unknown> {
    return this.http.post(`${api}/Publication/Notifications/Read`, null);
  }
}

@Injectable({ providedIn: 'root' })
export class ConnectionHttp {
  private readonly http = inject(HttpClient);

  status(): Observable<IConnectionsStatus> {
    return this.http.get<ICustomGenericResponse<IConnectionsStatus>>(`${api}/Connection`).pipe(unwrap());
  }

  usage(): Observable<IUsage> {
    return this.http.get<ICustomGenericResponse<IUsage>>(`${api}/Connection/Usage`).pipe(unwrap());
  }

  test(id: number): Observable<IConnectionTest> {
    return this.http.post<ICustomGenericResponse<IConnectionTest>>(`${api}/Connection/${id}/Test`, null).pipe(unwrap());
  }

  setDefault(id: number): Observable<string> {
    return this.http.post<ICustomGenericResponse<string>>(`${api}/Connection/${id}/Default`, null).pipe(unwrap());
  }

  saveAlias(id: number, alias: string | null): Observable<string> {
    return this.http.put<ICustomGenericResponse<string>>(`${api}/Connection/${id}/Alias`, { alias }).pipe(unwrap());
  }

  disconnect(id: number): Observable<IConnectionTest> {
    return this.http.delete<ICustomGenericResponse<IConnectionTest>>(`${api}/Connection/${id}`).pipe(unwrap());
  }

  /**
   * URL de inicio de sesión de Google, TikTok, LinkedIn o Teams; al volver, el back redirige a returnUrl con
   * ?youtubeAccount|tiktokAccount|linkedinAccount|teamsAccount=… Teams con `inbox` pide también leer respuestas.
   */
  oauthUrl(platform: OAuthPlatform, returnUrl: string, inbox = false): Observable<string> {
    return this.http
      .get<ICustomGenericResponse<{ url: string }>>(`${api}/Connection/${platform}/Connect`, { params: toParams({ returnUrl, inbox: inbox || null }) })
      .pipe(map(r => r.data!.url));
  }

  youtubeCategories(): Observable<ICategory[]> {
    return this.http.get<ICustomGenericResponse<ICategory[]>>(`${api}/Connection/Youtube/Categories`).pipe(unwrap());
  }

  /** Facebook, Instagram o WhatsApp: lo que da acceso el token del usuario del sistema. */
  metaAccounts(platform: MetaPlatform, systemUserToken: string): Observable<IMetaAccountOption[]> {
    const path = { Facebook: 'Facebook/Pages', Instagram: 'Instagram/Accounts', WhatsApp: 'WhatsApp/Numbers' }[platform];
    return this.http.post<ICustomGenericResponse<IMetaAccountOption[]>>(`${api}/Connection/${path}`, { systemUserToken }).pipe(unwrap());
  }

  metaSave(platform: MetaPlatform, systemUserToken: string, accountIds: string[]): Observable<IAccountSaveResult[]> {
    return this.http.post<ICustomGenericResponse<IAccountSaveResult[]>>(`${api}/Connection/${platform}`, { systemUserToken, accountIds }).pipe(unwrap());
  }

  telegramChats(credentialId: number): Observable<ITelegramChat[]> {
    return this.http.post<ICustomGenericResponse<ITelegramChat[]>>(`${api}/Connection/Telegram/Chats`, { credentialId }).pipe(unwrap());
  }

  telegramSave(credentialId: number, chat: string): Observable<IAccountSaveResult> {
    return this.http.post<ICustomGenericResponse<IAccountSaveResult>>(`${api}/Connection/Telegram`, { credentialId, chat }).pipe(unwrap());
  }

  saveSignature(id: number, signature: string | null): Observable<unknown> {
    return this.http.put(`${api}/Connection/${id}/Signature`, { signature });
  }

  youtubePlaylists(connectionId: number): Observable<IPlaylist[]> {
    return this.http.get<ICustomGenericResponse<IPlaylist[]>>(`${api}/Connection/${connectionId}/Youtube/Playlists`).pipe(unwrap());
  }

  /** Equipos y canales de la cuenta de trabajo que acaba de iniciar sesión (`pick` vale 10 minutos). */
  teamsChannels(pick: string): Observable<ITeamsChannelTree> {
    return this.http.get<ICustomGenericResponse<ITeamsChannelTree>>(`${api}/Connection/Teams/Channels`, { params: { pick } }).pipe(unwrap());
  }

  /** Conecta los canales marcados (una cuenta por canal). */
  teamsSave(pick: string, channels: { teamId: string; channelId: string }[]): Observable<IAccountSaveResult[]> {
    return this.http.post<ICustomGenericResponse<IAccountSaveResult[]>>(`${api}/Connection/Teams`, { pick, channels }).pipe(unwrap());
  }

  /** Canal por webhook (Workflows de Teams): devuelve el id de la conexión. */
  teamsWebhook(name: string, url: string): Observable<number> {
    return this.http.post<ICustomGenericResponse<number>>(`${api}/Connection/Teams/Webhook`, { name, url }).pipe(unwrap());
  }

  tiktokCreatorInfo(connectionId: number): Observable<ITiktokCreatorInfo> {
    return this.http.get<ICustomGenericResponse<ITiktokCreatorInfo>>(`${api}/Connection/${connectionId}/Tiktok/CreatorInfo`).pipe(unwrap());
  }
}

@Injectable({ providedIn: 'root' })
export class SettingsHttp {
  private readonly http = inject(HttpClient);

  platforms(): Observable<IPlatformSettings> {
    return this.http.get<ICustomGenericResponse<IPlatformSettings>>(`${api}/Settings/Platforms`).pipe(unwrap());
  }

  save(request: ICredentialSave): Observable<number> {
    return this.http.post<ICustomGenericResponse<number>>(`${api}/Settings/Platforms`, request).pipe(unwrap());
  }

  delete(id: number): Observable<string> {
    return this.http.delete<ICustomGenericResponse<string>>(`${api}/Settings/Platforms/${id}`).pipe(unwrap());
  }
}

@Injectable({ providedIn: 'root' })
export class TemplateHttp {
  private readonly http = inject(HttpClient);

  list(): Observable<ITemplate[]> {
    return this.http.get<ICustomGenericResponse<ITemplate[]>>(`${api}/Template`).pipe(unwrap());
  }

  /** Devuelve el Id de la plantilla. */
  save(body: ITemplateSave, id?: number | null): Observable<number> {
    const request = id ? this.http.put<ICustomGenericResponse<number>>(`${api}/Template/${id}`, body) : this.http.post<ICustomGenericResponse<number>>(`${api}/Template`, body);
    return request.pipe(unwrap());
  }

  delete(id: number): Observable<unknown> {
    return this.http.delete(`${api}/Template/${id}`);
  }

  /** Se usó al publicar o responder (orden por más usadas). */
  used(id: number): Observable<unknown> {
    return this.http.post(`${api}/Template/${id}/Used`, {});
  }

  blocks(): Observable<ITextBlock[]> {
    return this.http.get<ICustomGenericResponse<ITextBlock[]>>(`${api}/Template/Blocks`).pipe(unwrap());
  }

  saveBlock(body: { name: string; content: string }, id?: number | null): Observable<unknown> {
    return id ? this.http.put(`${api}/Template/Blocks/${id}`, body) : this.http.post(`${api}/Template/Blocks`, body);
  }

  deleteBlock(id: number): Observable<unknown> {
    return this.http.delete(`${api}/Template/Blocks/${id}`);
  }
}

@Injectable({ providedIn: 'root' })
export class InsightsHttp {
  private readonly http = inject(HttpClient);

  get(days: number): Observable<IInsights> {
    return this.http.get<ICustomGenericResponse<IInsights>>(`${api}/Insights`, { params: { days } }).pipe(unwrap());
  }

  health(): Observable<IHealth> {
    return this.http.get<ICustomGenericResponse<IHealth>>(`${api}/Insights/Health`).pipe(unwrap());
  }
}

/** Bandeja unificada. */
@Injectable({ providedIn: 'root' })
export class InboxHttp {
  private readonly http = inject(HttpClient);

  conversations(query: IInboxConversationQuery): Observable<IInboxConversation[]> {
    return this.http.get<ICustomGenericResponse<IInboxConversation[]>>(`${api}/Inbox/Conversations`, { params: toParams(query) }).pipe(unwrap());
  }

  conversation(id: number): Observable<IInboxConversation> {
    return this.http.get<ICustomGenericResponse<IInboxConversation>>(`${api}/Inbox/Conversations/${id}`).pipe(unwrap());
  }

  update(id: number, changes: { statusCode?: InboxStatus; markRead?: boolean; tags?: string[] }): Observable<IInboxConversation> {
    return this.http.patch<ICustomGenericResponse<IInboxConversation>>(`${api}/Inbox/Conversations/${id}`, changes).pipe(unwrap());
  }

  counts(): Observable<IInboxCounts> {
    return this.http.get<ICustomGenericResponse<IInboxCounts>>(`${api}/Inbox/Counts`).pipe(unwrap());
  }

  /** Mensajes del más nuevo al más viejo; con `before` (el más viejo cargado), la página anterior. */
  messages(conversationId: number, before?: { sentAt: string; id: number } | null, take = 50): Observable<IInboxMessage[]> {
    const params = toParams({ beforeAt: before?.sentAt, beforeId: before?.id, take });
    return this.http.get<ICustomGenericResponse<IInboxMessage[]>>(`${api}/Inbox/Conversations/${conversationId}/Messages`, { params }).pipe(unwrap());
  }

  send(conversationId: number, reply: IInboxReply): Observable<IInboxMessage> {
    return this.http.post<ICustomGenericResponse<IInboxMessage>>(`${api}/Inbox/Conversations/${conversationId}/Messages`, reply).pipe(unwrap());
  }

  resolve(messageId: number, action: InboxResolveAction): Observable<IInboxMessage> {
    return this.http.post<ICustomGenericResponse<IInboxMessage>>(`${api}/Inbox/Messages/${messageId}/Resolve`, { action }).pipe(unwrap());
  }

  /** Adjunto recibido (WhatsApp, Telegram): la API lo baja de la plataforma con la sesión. */
  attachment(messageId: number, index: number): Observable<Blob> {
    return this.http.get(`${api}/Inbox/Messages/${messageId}/Attachments/${index}`, { responseType: 'blob' });
  }

  /** Plantillas aprobadas de un número de WhatsApp. */
  templates(connectionId: number): Observable<IWhatsAppTemplate[]> {
    return this.http.get<ICustomGenericResponse<IWhatsAppTemplate[]>>(`${api}/Inbox/Accounts/${connectionId}/Templates`).pipe(unwrap());
  }

  /** Escribir primero por WhatsApp a un número, con plantilla. Devuelve la conversación. */
  startConversation(body: IConversationStart): Observable<IInboxConversation> {
    return this.http.post<ICustomGenericResponse<IInboxConversation>>(`${api}/Inbox/Conversations/Start`, body).pipe(unwrap());
  }

  /** Enlace para que la persona abra el chat (Telegram, Messenger, Instagram). */
  createInvite(connectionId: number, contactId: number): Observable<IInboxInvite> {
    return this.http.post<ICustomGenericResponse<IInboxInvite>>(`${api}/Inbox/Invites`, { connectionId, contactId }).pipe(unwrap());
  }

  contact(id: number): Observable<IInboxContactDetail> {
    return this.http.get<ICustomGenericResponse<IInboxContactDetail>>(`${api}/Inbox/Contacts/${id}`).pipe(unwrap());
  }

  /** Alta en la agenda. */
  createContact(body: IContactCreate): Observable<IInboxContactDetail> {
    return this.http.post<ICustomGenericResponse<IInboxContactDetail>>(`${api}/Inbox/Contacts`, body).pipe(unwrap());
  }

  searchContacts(searchTerm: string, excludeId?: number | null): Observable<IInboxContact[]> {
    return this.http.get<ICustomGenericResponse<IInboxContact[]>>(`${api}/Inbox/Contacts`, { params: toParams({ searchTerm, excludeId: excludeId ?? undefined }) }).pipe(unwrap());
  }

  /** Vincula el contacto con otro (la misma persona en otra red); null = desvincular. */
  linkContact(id: number, otherId: number | null): Observable<IInboxContactDetail> {
    return this.http.put<ICustomGenericResponse<IInboxContactDetail>>(`${api}/Inbox/Contacts/${id}/Link`, { otherId }).pipe(unwrap());
  }

  rules(): Observable<IInboxRules> {
    return this.http.get<ICustomGenericResponse<IInboxRules>>(`${api}/Inbox/Rules`).pipe(unwrap());
  }

  settings(): Observable<IInboxSettings> {
    return this.http.get<ICustomGenericResponse<IInboxSettings>>(`${api}/Inbox/Settings`).pipe(unwrap());
  }

  saveAccount(id: number, body: { inboxDirect: boolean; inboxComments: boolean }): Observable<IInboxAccount> {
    return this.http.put<ICustomGenericResponse<IInboxAccount>>(`${api}/Inbox/Accounts/${id}`, body).pipe(unwrap());
  }

  /** Vuelve a suscribir la cuenta a los avisos (o a poner el webhook del bot). */
  prepareAccount(id: number): Observable<IInboxAccount> {
    return this.http.post<ICustomGenericResponse<IInboxAccount>>(`${api}/Inbox/Accounts/${id}/Prepare`, null).pipe(unwrap());
  }
}

@Injectable({ providedIn: 'root' })
export class HomeHttp {
  private readonly http = inject(HttpClient);

  /** El día de hoy del usuario (su medianoche) en UTC: el servidor no sabe su zona horaria. */
  summary(dayStart: Date, dayEnd: Date): Observable<IHomeSummary> {
    const params = toParams({ dayStart: dayStart.toISOString(), dayEnd: dayEnd.toISOString() });
    return this.http.get<ICustomGenericResponse<IHomeSummary>>(`${api}/Home/Summary`, { params }).pipe(unwrap());
  }
}
