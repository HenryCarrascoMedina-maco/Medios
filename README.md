# YoutubeMeta

Sube videos, imágenes y PDF a una biblioteca propia y publícalos en **varias cuentas** de YouTube, Facebook, Instagram,
Telegram, TikTok y canales de Microsoft Teams con un solo clic: texto, enlace, imagen, carrusel, video o documento, con primer comentario
opcional. Atiende en una **bandeja unificada** los mensajes privados y comentarios de Facebook, Instagram, WhatsApp, Telegram,
YouTube y Teams, con un **panel de inicio** que reúne lo urgente.
Proyecto independiente que reúne, en pequeño, piezas de Sinsatools: subida TUS por partes de 10 MB,
reproducción por pedazos con ticket, cola SQL con lease, OAuth de Google, token de Página de Meta y
progreso en tiempo real por SignalR.

Planes y maquetas: [plan-youtubemeta.html](plan-youtubemeta.html), [plan-multicuenta-plataformas.html](plan-multicuenta-plataformas.html)
[plan-mejoras.html](plan-mejoras.html) (revisión, fiabilidad y funciones nuevas),
[plan-linkedin-posts.html](plan-linkedin-posts.html) (publicaciones y LinkedIn), [plan-teams.html](plan-teams.html)
(Microsoft Teams), [plan-bandeja-dashboard.html](plan-bandeja-dashboard.html) (bandeja, inicio y menú por módulos) y
[plan-plantillas.html](plan-plantillas.html) (plantillas propias con etiquetas y adjuntos).

Además: biblioteca con filtros, etiquetas y acciones en lote; plantillas propias (de publicación y respuestas `/atajo` de la bandeja) con un editor de etiquetas
(`{titulo}`, `{nombre}`, campos a completar `{?precio}`, bloques de hashtags) y adjuntos de la biblioteca; vista previa
por plataforma; calendario con arrastrar para reprogramar; miniatura propia y listas de reproducción en YouTube;
resultados (vistas, «me gusta», éxito por cuenta) y panel de salud del sistema.

| Plataforma | Cómo se conecta | Notas |
|---|---|---|
| YouTube | OAuth de Google (un clic por canal) | Cuota del proyecto compartida por todos los canales. Sin auditoría, los videos quedan privados. |
| Facebook | Token del usuario del sistema de Meta Business (varias Páginas a la vez) | Se guarda el token de cada Página. |
| Instagram | El mismo token de Meta, con permisos de Instagram | Reels de hasta 300 MB y 15 min. Cuenta profesional vinculada a una Página. |
| Telegram | Bot de @BotFather como administrador del canal | 50 MB por video (2 GB con servidor Bot API propio). |
| TikTok | Login Kit (OAuth) | RedirectUri **https** obligatoria. Sin auditoría, solo «Solo yo». Fotos: dominio verificado. |
| LinkedIn | **Desactivado** en esta instalación (`Platforms:Disabled`). El código y los datos se conservan. | Texto, enlace, imágenes, video y PDF. El acceso dura 60 días: hay que reconectar. |
| Teams | Microsoft Graph con una app de Entra (se eligen los canales) o webhook de Workflows por canal | Graph: texto, imágenes, video y PDF (a «Archivos» del canal), @canal y respuesta en el hilo. Webhook: texto, enlace e imágenes por URL pública. |
| WhatsApp | Token del usuario del sistema de Meta (números de WhatsApp Business) | **Solo bandeja**: no hay API para publicar en Estados ni Canales, pero sí para chatear (Cloud API). |

### Bandeja (mensajes y comentarios)

| Plataforma | Qué llega | Cómo llega | Límites |
|---|---|---|---|
| Facebook | Messenger y comentarios de la Página | Webhook de la app de Meta | Responder solo 24 h tras el último mensaje (7 días con la etiqueta «agente humano» si Meta la aprobó). Para cualquier persona, revisión de la app. |
| Instagram | DM y comentarios | Webhook de la app de Meta | Igual que Messenger; activar «Permitir acceso a los mensajes» en la app de Instagram. |
| WhatsApp | Mensajes | Webhook de la app de Meta | Fuera de 24 h solo plantillas aprobadas (Meta las cobra). |
| Telegram | Mensajes al bot y grupo de discusión del canal | Webhook con dirección pública; si no, `getUpdates` cada 15 s | El bot no puede escribir primero. |
| YouTube | Comentarios | Consulta cada 10 min | Leer 1 unidad, responder 50 (mismo cupo que las subidas). Permiso `youtube.force-ssl`: reconectar los canales una vez. |
| Teams | Respuestas en los hilos de lo publicado | Consulta cada 5 min | Permiso `ChannelMessage.Read.All` (consentimiento del administrador). Los canales por webhook no leen. |
| TikTok | — | — | Su API no deja leer mensajes ni comentarios a apps como esta. |

Cada plataforma tiene su guía paso a paso con capturas y preguntas frecuentes en `/guides/<plataforma>`.

## Estructura

| Carpeta | Contenido |
|---|---|
| `src/YoutubeMeta.Api` | .NET 9: API, jobs de publicación y de bandeja, webhooks, hub SignalR. En producción sirve también el Angular compilado (`wwwroot`). Bandeja: `Application/Inbox` (servicio, procesador, contrato `IInboxChannel`) y un adaptador por plataforma en `Infrastructure/External/<Plataforma>/*Inbox.cs`. |
| `src/YoutubeMeta.Web` | Angular 19 (standalone, signals) + Tailwind 3. |
| `tests/YoutubeMeta.Tests` | xUnit: máquina de estados de la cola, latido, reglas, seguridad, TUS, y pruebas de integración de los procedimientos contra LocalDB (base desechable `YoutubeMeta_Tests`; se omiten si no hay LocalDB). |
| `src/YoutubeMeta.Web` (pruebas) | Jest (`npm test`): utilidades, sesión, subidas, interceptor y componentes compartidos. |
| `database` | Scripts SQL Server: `000` crear base, `001` esquema (completo), `002` procedimientos, `003` migración a varias cuentas, `004` fiabilidad de la cola, `005` etiquetas/plantillas/métricas, `006` publicaciones con varios archivos y LinkedIn (renombra `Videos` → `Media_Assets` y `Video_Publications` → `Publications`), `007` Microsoft Teams, `008` bandeja, WhatsApp e inicio, `010` plantillas propias (une plantillas y respuestas rápidas en `Templates` + `Template_Media`), `900` pruebas (se deshacen), `999` rollback. `dbo.Schema_Versions` registra lo aplicado. |
| `storage` | (no versionado) videos, miniaturas y subidas en curso. Se configura en `Storage:Root`. |

## Puesta en marcha (desarrollo)

1. **Base de datos** (SQL Server o LocalDB): ejecutar en orden `000-crear-base.sql` (en `master`), y dentro de `YoutubeMeta`
   `001-esquema.sql` y `002-procedimientos.sql`. Opcional: `900-pruebas-dev.sql`.
   **Base existente** (los datos se conservan; todos los scripts se pueden repetir; haz antes una copia de seguridad):
   - creada antes del 13/11/2026: `003-migracion-multicuenta.sql`;
   - sin `004`/`005`: `004-mejoras.sql` y `005-funciones.sql`;
   - sin `006` (no existe la tabla `Media_Assets`): `006-publicaciones.sql`;
   - sin `007` (Teams): `007-teams.sql`;
   - sin `008` (no existe la tabla `Inbox_Messages`): `008-bandeja.sql`;
   - sin `009` (no existe la tabla `Inbox_Invites`): `009-contactos-invitaciones.sql` (agenda de contactos e invitaciones por enlace);
   - sin `010` (no existe la tabla `Templates`): `010-plantillas.sql` (copia las plantillas y respuestas rápidas y borra las tablas viejas);
   - y al final, siempre, `002-procedimientos.sql`.
2. **Secretos** (nunca en `appsettings.json`), desde `src/YoutubeMeta.Api`:

   ```powershell
   dotnet run -- --hash-password "TuClave"          # copia el resultado
   dotnet user-secrets set "Auth:AdminPasswordHash" "pbkdf2$..."
   dotnet user-secrets set "Auth:JwtKey" "<texto aleatorio de 32+ caracteres>"
   dotnet user-secrets set "Security:SecretKey" "<32 bytes en base64>"   # [Convert]::ToBase64String((1..32|%{Get-Random -Max 256}))
   ```

   `Security:SecretKey` cifra los tokens y claves guardados en BD: si se cambia, hay que volver a conectar las cuentas
   y guardar de nuevo las claves de Ajustes.
   Las claves de Google, TikTok y los bots de Telegram se guardan desde la app (**Ajustes › Plataformas**). Como respaldo
   siguen valiendo `Google:ClientId` / `Google:ClientSecret` y `Tiktok:ClientKey` / `Tiktok:ClientSecret` en user-secrets.
3. **API**: `dotnet run` en `src/YoutubeMeta.Api` (http://localhost:5080).
4. **Front**: `npm install` y `npm start` en `src/YoutubeMeta.Web` (http://localhost:4200; `/api` y `/hubs` van por proxy a la API).
5. Entrar con `admin` y la clave del paso 2 → **Ajustes** (claves) → **Conexiones** → seguir la guía de cada plataforma.

### Google Cloud (una vez)

- Proyecto con **YouTube Data API v3** habilitada.
- Cliente OAuth **Web application** con el redirect `http://localhost:5080/api/Connection/Youtube/Callback`
  (en producción, `https://<sitio>/api/Connection/Youtube/Callback` y `Google:RedirectUri` igual).
- Pantalla de consentimiento External, scopes `youtube.upload` y `youtube.readonly`. En *Testing* el acceso caduca a los 7 días.

### Meta (una vez)

Usuario del sistema con las Páginas (y cuentas de Instagram) asignadas con «Contenido» y token con `pages_show_list`,
`pages_read_engagement`, `pages_manage_posts` y, para Instagram, `instagram_basic` e `instagram_content_publish`.
Facebook guarda el token de cada Página; Instagram guarda el del usuario del sistema (ambos cifrados). App en modo **Live**.

### TikTok (una vez)

App en TikTok for Developers con **Login Kit** y **Content Posting API**, scopes `user.info.basic`, `video.publish` y
`video.upload`. `Tiktok:RedirectUri` debe ser **https** (`https://<sitio>/api/Connection/Tiktok/Callback`; en local, un túnel).

### LinkedIn (una vez)

Guía detallada en la app: `/guides/linkedin`. Resumen:

- **Perfil personal**: app en https://www.linkedin.com/developers/apps con los productos *Sign In with LinkedIn using
  OpenID Connect* y *Share on LinkedIn* (scopes `openid profile w_member_social`). URL de retorno
  `https://<sitio>/api/Connection/Linkedin/Callback` (en local vale `http://localhost:5080/...`). Client ID y secreto en
  **Ajustes › Plataformas › LinkedIn** (o `Linkedin:ClientId` / `Linkedin:ClientSecret`).
- **Página de empresa**: otra app con *Community Management API* (LinkedIn la revisa; scopes `w_organization_social
  rw_organization_admin r_organization_social`), URL de retorno `.../api/Connection/LinkedinOrg/Callback`. Quien conecta
  debe administrar la página. Se conectan todas las páginas que administra; se quitan las que sobren.
- El acceso caduca a los 60 días (salvo apps aprobadas con renovación): la app avisa y la cuenta pasa a «Reconectar».
- `Linkedin:ApiVersion` (AAAAMM): LinkedIn retira cada versión en ~1 año; el panel de salud avisa a los 10 meses.

### Microsoft Teams (una vez)

Guía detallada en la app: `/guides/teams`. Resumen:

- **Forma A (Graph)**: registro de app en https://entra.microsoft.com (inquilino único), URL de retorno
  `https://<sitio>/api/Connection/Teams/Callback` (en local `http://localhost:5080/...`), secreto de cliente y permisos
  delegados `ChannelMessage.Send Team.ReadBasic.All Channel.ReadBasic.All Files.ReadWrite.All User.Read offline_access`.
  Id. de aplicación, Id. de directorio, secreto y su fecha de caducidad en **Ajustes › Plataformas › Teams**. Si la
  organización exige consentimiento de administrador, la guía trae el mensaje y el enlace para TI. Solo cuentas de
  trabajo o escuela.
- **Forma B (webhook)**: en el canal, *Flujos de trabajo* › «Publicar en un canal cuando se reciba una solicitud de
  webhook»; la URL se pega en Conexiones › Teams. Los antiguos conectores de Office 365 (`webhook.office.com`) ya no
  funcionan.
- Leer mensajes del canal exige un permiso de administrador que no se pide: si se corta la red justo al enviar, la
  publicación queda en **Revisar**. Tampoco hay métricas de Teams.

### Bandeja: webhooks y dirección pública (una vez)

Guía detallada en la app: `/guides/whatsapp` (pasos 5 y 6 valen para Facebook, Instagram y WhatsApp). Resumen:

- Facebook, Instagram y WhatsApp avisan a `https://<sitio>/api/Webhook/Meta`: hace falta `App:PublicBaseUrl` con **https**
  (en desarrollo, un túnel como Dev Tunnels o cloudflared apuntando al puerto 5080).
- **Ajustes › Plataformas › App de Meta (bandeja)**: App ID y App Secret (verifica la firma `X-Hub-Signature-256`). Al
  guardar se genera el **texto de verificación**; URL y texto se pegan en la app de Meta › Webhooks (campos `messages`,
  `feed`/`comments`).
- Telegram con dirección pública usa webhook (`/api/Webhook/Telegram/{bot}` con secreto propio por bot); sin ella, `getUpdates`.
- **Configuración › Bandeja** dice, cuenta por cuenta, si recibe y qué le falta (permiso, reconectar, dirección pública).
- `Jobs:Inbox`: ritmos de consulta, reintentos, retención de mensajes (12 meses) y `MetaHumanAgentTag` (solo si Meta lo aprobó).

### Plataformas desactivadas

`Platforms:Disabled` (p. ej. `["LINKEDIN"]`) apaga una plataforma sin borrar nada: desaparece de la app (conexiones,
ajustes, publicar, filtros, guías), su carril del job no arranca, no se prueba ni se piden sus métricas, y lo pendiente se
cancela con el motivo. Para volver a activarla basta con quitarla de la lista.

### Imágenes en Instagram y TikTok

Estas dos plataformas descargan las imágenes desde una URL pública. Pon `App:PublicBaseUrl` con la dirección **https**
del sitio: la API genera enlaces firmados de 1-2 h (`/api/Media/Public/...`). En TikTok, además, verifica ese dominio
en el portal (URL properties). Sin dirección pública esos destinos aparecen deshabilitados con el motivo.

### Primer comentario

Facebook necesita `pages_manage_engagement` y Instagram `instagram_manage_comments` en el token del usuario del
sistema; LinkedIn lo permite con los mismos permisos de publicar. Si falla, la publicación queda hecha con un aviso y el
botón «Reintentar comentario».

## Publicación en IIS

```powershell
dotnet publish src/YoutubeMeta.Api -c Release -o D:\Publicar\YoutubeMeta
```

`dotnet publish` ejecuta `npm ci` + `ng build` y deja el Angular en `wwwroot` (omitir con `-p:SkipWebBuild=true`).

En el sitio de IIS:

- **App pool → Start Mode = AlwaysRunning** e **Idle Time-out = 0**; en el sitio **Preload Enabled = True**.
  Sin esto IIS detiene el proceso por inactividad y con él el job que publica en las plataformas.
- Desactivar el reciclado periódico (Regular Time Interval = 0). Si aun así se recicla, la subida se reanuda desde
  la última parte confirmada (sesión guardada en BD).
- Característica **WebSocket Protocol** instalada (SignalR).
- Secretos como variables de entorno del app pool (`Auth__JwtKey`, `Security__SecretKey`, `Google__RedirectUri`,
  `Tiktok__RedirectUri`, …) o en un
  `appsettings.Production.json` fuera del repositorio.
- `App:PublicBaseUrl` = `https://<sitio>` (imágenes en Instagram/TikTok y URL de retorno de LinkedIn por defecto).
- `App:FrontBaseUrl` vacío (front y API en el mismo sitio). `Storage:Root` con permisos de escritura para la identidad del app pool.
- **Desactivar el reciclado solapado** (*Disable Overlapped Recycle = True*): dos procesos a la vez podrían renovar el token
  de TikTok en paralelo y desconectar la cuenta.
- Con certificado, `App:ForceHttps = true` (redirige a https y envía HSTS). Detrás de un proxy se respetan
  `X-Forwarded-For` y `X-Forwarded-Proto`. Poner `AllowedHosts` con el dominio real.
- Monitorización: `GET /health` (sin autenticación) devuelve `{"status":"Healthy|Degraded|Unhealthy"}` (BD y job de
  publicación). El detalle con alertas está en la app (**Resultados**) y en `GET /api/Insights/Health`.

## Cómo se comporta la cola ante fallos

En la bandeja vale lo mismo: los avisos se guardan en crudo (idempotentes: un reintento de la plataforma no duplica) y las
respuestas pasan por una cola con lease; si el envío se corta y no se sabe si llegó, queda en **Revisar** con «Ya se envió»
o «Reintentar».


- Cada plataforma tiene su propio carril en el job: una subida larga a YouTube no retrasa a las demás.
- Todo lo que se reintenta solo tiene tope (`MaxAttempts`); al agotarlo, el mensaje dice qué revisar.
- Si se corta la red justo cuando la plataforma recibía el video, el job comprueba en la plataforma antes de volver a
  subirlo (Facebook lo termina solo si quedó a medias). Si no se puede comprobar (Telegram), la publicación queda en
  **Revisar** con instrucciones y dos botones: «Ya está publicado» o «Publicar de nuevo». Así nunca se duplica en silencio.
- Un contenedor de Instagram caducado se vuelve a subir solo; un fallo pasajero de TikTok al renovar el token ya no
  obliga a reconectar.

## Seguridad

- Login: 10 intentos por minuto por IP y bloqueo progresivo tras 5 fallos (1, 2, 4… hasta 30 min).
- La sesión se renueva sin volver a pedir la contraseña (`POST /api/Auth/Refresh`); si caduca, la app pide la contraseña
  sin perder la pantalla y pausa las subidas hasta entonces.
- Los errores inesperados llegan al usuario como un mensaje genérico con un código; el detalle queda en el registro.

## Pruebas

```powershell
dotnet test YoutubeMeta.slnx            # API (las de BD usan LocalDB y crean/borran YoutubeMeta_Tests)
cd src/YoutubeMeta.Web; npm test        # front (Jest)
```
