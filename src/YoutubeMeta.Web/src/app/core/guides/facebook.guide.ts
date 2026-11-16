import { IGuide, IShotNavItem } from './guide.models';

export const BUSINESS = 'business.facebook.com/latest/settings';

/** Menú lateral de Ajustes del portfolio empresarial (Meta Business). También lo usa la guía de Instagram. */
export function businessMenu(active: string, mark?: number): IShotNavItem[] {
  const items = [
    { label: 'Usuarios', group: true },
    { label: 'Personas' },
    { label: 'Socios' },
    { label: 'Usuarios del sistema' },
    { label: 'Cuentas', group: true },
    { label: 'Páginas' },
    { label: 'Cuentas publicitarias' },
    { label: 'Aplicaciones' },
    { label: 'Cuentas de Instagram' }
  ];
  return items.map(i => (i.label === active ? { ...i, active: true, mark } : i));
}

export const FACEBOOK_GUIDE: IGuide = {
  platform: 'facebook',
  title: 'Conectar Páginas de Facebook',
  intro:
    'Facebook no permite iniciar sesión «con tu cuenta» para publicar desde un servidor. Se usa un **usuario del sistema**: una cuenta técnica de tu portfolio empresarial ' +
    'que no caduca ni depende de la contraseña de nadie. Para crearlo, Meta exige antes una **app** dentro del portfolio. El orden importa: si saltas un paso, el siguiente aparece bloqueado.',
  duration: '15–20 minutos la primera vez',
  requirements: [
    'Ser **administrador** del portfolio empresarial (en Personas debe decir «Acceso total»).',
    'Una **Página** de Facebook (no un perfil personal) de la que seas administrador.',
    'Una URL con la **política de privacidad** de tu empresa (Meta la exige para publicar la app).'
  ],
  steps: [
    {
      id: 'pagina',
      title: 'Añade la Página al portfolio empresarial',
      link: { label: 'Abrir Cuentas › Páginas', url: `https://${BUSINESS}/pages` },
      summary: 'El usuario del sistema solo puede recibir Páginas que estén dentro del portfolio. Si ya aparece en la lista, salta al paso 2.',
      actions: [
        'En **Ajustes**, menú **Cuentas › Páginas**.',
        'Pulsa **Añadir** › **Añadir una página existente**.',
        'Escribe el nombre o la URL de la Página y pulsa **Añadir página**.'
      ],
      shot: {
        url: `${BUSINESS}/pages`,
        sidebar: businessMenu('Páginas', 1),
        title: 'Páginas',
        buttons: [{ label: '+ Añadir', primary: true, mark: 2 }],
        blocks: [
          { kind: 'option', label: 'Añadir una página existente', sub: 'Eres administrador de la Página', checked: true, mark: 3 },
          { kind: 'option', label: 'Solicitar acceso a una página', sub: 'La Página es de otro portfolio', checked: false },
          { kind: 'option', label: 'Crear una página nueva', checked: false }
        ]
      },
      check: 'La Página aparece en **Cuentas › Páginas** con su nombre y foto.',
      notes: [
        'Si eres administrador de la Página se añade al instante. Si pertenece a **otro** portfolio, usa «Solicitar acceso»: su dueño debe aprobarlo.',
        'Un perfil personal no sirve: Facebook solo permite publicar por API en Páginas.'
      ],
      faqIds: ['no-veo-pagina', 'perfil-personal']
    },
    {
      id: 'app',
      title: 'Crea una app y conéctala al portfolio',
      link: { label: 'Abrir Meta for Developers', url: 'https://developers.facebook.com/apps/creation/' },
      summary:
        'Este es el paso que desbloquea «Usuarios del sistema». Si ves el mensaje «Para poder añadir un usuario del sistema, una aplicación debe formar parte de este porfolio empresarial», te falta este paso.',
      actions: [
        'En **developers.facebook.com** pulsa **Mis apps › Crear app** (si es tu primera vez, Meta te pide registrarte como desarrollador: acepta y verifica tu correo).',
        '**Detalles de la app**: nombre (por ejemplo `YoutubeMeta Publicador`) y correo de contacto.',
        '**Casos de uso**: elige **«Administrar todo en tu página»** (en inglés, *Manage everything on your Page*).',
        '**Empresa**: elige tu **portfolio empresarial**. Esto es lo que conecta la app con el portfolio.',
        'Revisa y pulsa **Crear app**. Te pedirá tu contraseña de Facebook.'
      ],
      shot: {
        url: 'developers.facebook.com/apps/creation',
        title: 'Crear una app',
        sidebar: [
          { label: 'Detalles de la app', mark: 2 },
          { label: 'Casos de uso', active: true, mark: 3 },
          { label: 'Empresa', mark: 4 },
          { label: 'Requisitos' },
          { label: 'Información general' }
        ],
        blocks: [
          { kind: 'heading', text: '¿Qué quieres que haga tu app?' },
          { kind: 'option', label: 'Administrar todo en tu página', sub: 'Publicar contenido, ver estadísticas, responder comentarios', checked: true, mark: 3 },
          { kind: 'option', label: 'Crear y administrar anuncios con la API de marketing', checked: false },
          { kind: 'option', label: 'Autenticar y solicitar datos a los usuarios con el inicio de sesión con Facebook', checked: false }
        ]
      },
      check: 'En **Ajustes › Cuentas › Aplicaciones** aparece la app, y en **Usuarios del sistema** el botón **Añadir** ya está activo (azul).',
      notes: [
        '¿Ya tenías una app creada fuera del portfolio? En **Ajustes › Cuentas › Aplicaciones › Añadir › Conectar un identificador de aplicación** pega su **identificador** (lo ves en el panel de la app, *Configuración de la app › Básica*).'
      ],
      faqIds: ['usuarios-sistema-bloqueado', 'registro-desarrollador-bloqueado', 'app-otro-portfolio']
    },
    {
      id: 'permisos',
      title: 'Añade los permisos de Página al caso de uso',
      link: { label: 'Abrir mis apps', url: 'https://developers.facebook.com/apps/' },
      summary: 'Si no los añades aquí, después no aparecen al generar el token.',
      actions: [
        'En el panel de la app, menú **Casos de uso**, pulsa **Personalizar** en «Administrar todo en tu página».',
        'Pulsa **Añadir** junto a `pages_show_list`, `pages_read_engagement` y `pages_manage_posts`.',
        'Comprueba que los tres quedan con estado **Listo para pruebas** o **Añadido**.'
      ],
      shot: {
        url: 'developers.facebook.com/apps/…/use_cases/customize',
        sidebar: [
          { label: 'Panel' },
          { label: 'Casos de uso', active: true, mark: 1 },
          { label: 'Configuración de la app' },
          { label: 'Roles de la app' },
          { label: 'Publicar' }
        ],
        title: 'Permisos',
        blocks: [
          { kind: 'row', label: 'pages_show_list', sub: 'Listar las Páginas', button: 'Añadir', mark: 2 },
          { kind: 'row', label: 'pages_read_engagement', sub: 'Leer contenido y datos de la Página', button: 'Añadir', mark: 2 },
          { kind: 'row', label: 'pages_manage_posts', sub: 'Crear y editar publicaciones (incluye videos)', button: 'Añadir', mark: 2 }
        ]
      },
      check: 'Los tres permisos aparecen en la lista del caso de uso, sin el botón «Añadir».',
      faqIds: ['no-aparecen-permisos']
    },
    {
      id: 'publicar-app',
      title: 'Completa los datos básicos y publica la app',
      summary:
        'Mientras la app está en modo **desarrollo**, los videos que publique solo los ven las personas con rol en la app. Para que los vea todo el mundo, la app debe estar **publicada** (modo *Live*).',
      actions: [
        'Menú **Configuración de la app › Básica**: completa **URL de la política de privacidad**, **Categoría** e **ícono**. Pulsa **Guardar cambios**.',
        'Menú **Publicar** (o el interruptor **Modo de la app** arriba): pulsa **Publicar**.',
        'Si Meta muestra requisitos pendientes, complétalos con lo que indique la propia pantalla y vuelve a publicar.'
      ],
      shot: {
        url: 'developers.facebook.com/apps/…/settings/basic',
        sidebar: [
          { label: 'Panel' },
          { label: 'Casos de uso' },
          { label: 'Configuración de la app', active: true, mark: 1 },
          { label: 'Roles de la app' },
          { label: 'Publicar', mark: 2 }
        ],
        title: 'Básica',
        blocks: [
          { kind: 'field', label: 'Identificador de la app', value: '1234567890123456' },
          { kind: 'field', label: 'URL de la política de privacidad', value: 'https://tuempresa.com/privacidad', mark: 1 },
          { kind: 'field', label: 'Categoría', value: 'Empresas y páginas', mark: 1 },
          { kind: 'note', tone: 'ok', text: 'Modo de la app: Publicada' }
        ]
      },
      check: 'Arriba del panel de la app dice **Publicada** / **Live**, no «En desarrollo».',
      notes: [
        'Para publicar en **tus propias** Páginas no hace falta *App Review* ni verificar el negocio: basta con el acceso estándar.'
      ],
      faqIds: ['nadie-ve-video', 'app-review']
    },
    {
      id: 'usuario-sistema',
      title: 'Crea el usuario del sistema',
      link: { label: 'Abrir Usuarios del sistema', url: `https://${BUSINESS}/system_users` },
      summary: 'Es la «cuenta técnica» que publicará. No es una persona, no tiene contraseña y no se desconecta si alguien deja la empresa.',
      actions: [
        'En **Ajustes › Usuarios › Usuarios del sistema** pulsa **Añadir** (si está gris, vuelve al paso 2).',
        'Acepta las condiciones de uso de usuarios del sistema.',
        'Nombre: `youtubemeta-publicador`. Rol: **Empleado** (basta; no necesita ser administrador).',
        'Pulsa **Crear usuario del sistema**.'
      ],
      shot: {
        url: `${BUSINESS}/system_users`,
        sidebar: businessMenu('Usuarios del sistema', 1),
        title: 'Usuarios del sistema',
        buttons: [{ label: '+ Añadir', primary: true, mark: 1 }],
        blocks: [
          { kind: 'heading', text: 'Crear usuario del sistema' },
          { kind: 'field', label: 'Nombre del usuario del sistema', value: 'youtubemeta-publicador', mark: 3 },
          { kind: 'field', label: 'Rol del usuario del sistema', value: 'Empleado', mark: 3 }
        ]
      },
      check: 'El usuario `youtubemeta-publicador` aparece en la lista de **Usuarios del sistema**.',
      faqIds: ['usuarios-sistema-bloqueado', 'limite-usuarios-sistema']
    },
    {
      id: 'activos',
      title: 'Asígnale la Página y la app',
      link: { label: 'Abrir Usuarios del sistema', url: `https://${BUSINESS}/system_users` },
      summary: 'El usuario del sistema empieza sin acceso a nada. Hay que darle la Página (para publicar) y la app (para poder generar su token).',
      actions: [
        'Selecciona `youtubemeta-publicador` y pulsa **Asignar activos**.',
        'Tipo de activo **Páginas**: marca tu Página y activa **Contenido** (o «Control total»). Pulsa **Asignar activos**.',
        'Repite con el tipo **Aplicaciones**: marca tu app y activa **Administrar app** / «Control total».'
      ],
      shot: {
        url: `${BUSINESS}/system_users`,
        title: 'Asignar activos · youtubemeta-publicador',
        sidebar: [
          { label: 'Páginas', active: true, mark: 2 },
          { label: 'Aplicaciones', mark: 3 },
          { label: 'Cuentas publicitarias' },
          { label: 'Catálogos' }
        ],
        buttons: [{ label: 'Asignar activos', primary: true, mark: 1 }],
        blocks: [
          { kind: 'check', label: 'Tu Página', checked: true, mark: 2 },
          { kind: 'heading', text: 'Control parcial' },
          { kind: 'check', label: 'Contenido · Crear, administrar o eliminar contenido', checked: true, mark: 2 },
          { kind: 'check', label: 'Estadísticas', checked: false },
          { kind: 'check', label: 'Anuncios', checked: false }
        ]
      },
      check: 'En el detalle del usuario del sistema aparecen la **Página** (con «Contenido») y la **app**.',
      notes: ['Para **cambiar de Página** más adelante basta con asignar aquí la nueva Página: el mismo token sirve.'],
      faqIds: ['pagina-gris', 'no-aparece-app']
    },
    {
      id: 'token',
      title: 'Genera el token',
      link: { label: 'Abrir Usuarios del sistema', url: `https://${BUSINESS}/system_users` },
      summary: 'El token es la «llave» que pegarás en YoutubeMeta. Meta lo muestra **una sola vez**.',
      actions: [
        'Con `youtubemeta-publicador` seleccionado, pulsa **Generar token**.',
        'Elige tu **app**.',
        'Caducidad del token: **Nunca**.',
        'Marca `pages_show_list`, `pages_read_engagement` y `pages_manage_posts` y pulsa **Generar token**.',
        'Pulsa **Copiar** y pégalo de inmediato en el paso 8.'
      ],
      shot: {
        url: `${BUSINESS}/system_users`,
        title: 'Generar token',
        buttons: [{ label: 'Generar token', primary: true, mark: 1 }],
        blocks: [
          { kind: 'field', label: 'App', value: 'YoutubeMeta Publicador', mark: 2 },
          { kind: 'option', label: 'Nunca', sub: 'Caducidad del token', checked: true, mark: 3 },
          { kind: 'check', label: 'pages_show_list', checked: true, mark: 4 },
          { kind: 'check', label: 'pages_read_engagement', checked: true, mark: 4 },
          { kind: 'check', label: 'pages_manage_posts', checked: true, mark: 4 },
          { kind: 'check', label: 'business_management', checked: false },
          { kind: 'secret', label: 'EAAG…', mark: 5 }
        ]
      },
      check: 'Tienes copiado un texto largo que empieza por `EAA`.',
      notes: ['No lo guardes en correos ni chats. YoutubeMeta no lo guarda: solo lo usa para obtener el token de la Página, que se guarda cifrado.'],
      faqIds: ['no-aparecen-permisos', 'no-aparece-app', 'perdi-token']
    },
    {
      id: 'conectar',
      title: 'Conéctalo en YoutubeMeta',
      summary: 'Último paso, aquí mismo en **Conexiones**.',
      actions: [
        'En la tarjeta de Facebook pulsa **+ Añadir Páginas**.',
        'Pega el token y pulsa **Buscar Páginas**.',
        'Marca **una o varias** Páginas y pulsa **Conectar**.',
        'En cada Página pulsa **Probar**: debe salir en verde.'
      ],
      shot: {
        url: 'YoutubeMeta › Conexiones',
        title: 'Conectar Páginas de Facebook',
        blocks: [
          { kind: 'secret', label: 'EAAG…', mark: 2 },
          { kind: 'check', label: 'Tu Página · Empresa', checked: true, mark: 3 },
          { kind: 'check', label: 'Otra Página · Tienda', checked: true, mark: 3 },
          { kind: 'note', tone: 'ok', text: '2 Páginas conectadas.' }
        ],
        buttons: [{ label: 'Buscar Páginas', mark: 2 }, { label: 'Conectar 2', primary: true, mark: 3 }]
      },
      check: 'La tarjeta de Facebook muestra cada Página en su fila con la etiqueta **Conectada**. La primera queda con **★** (viene marcada al publicar).',
      faqIds: ['token-invalido', 'pagina-gris', 'lista-vacia']
    },
    {
      id: 'cambiar',
      title: 'Añadir más Páginas, ★ por defecto y quitar',
      optional: true,
      summary: 'No hay que repetir todo: el usuario del sistema, la app y el token se reutilizan.',
      actions: [
        'Añade la nueva Página al portfolio (paso 1) si aún no está.',
        'Asígnala a `youtubemeta-publicador` con **Contenido** (paso 6).',
        'En YoutubeMeta pulsa **+ Añadir Páginas**, pega el **mismo** token y marca la nueva Página.',
        'Usa **★ Marcar por defecto** en la Página que quieras que venga marcada al publicar y **✎ Nombre corto** para distinguirlas.'
      ],
      check: 'Cada Página aparece en su propia fila. Al publicar puedes marcar varias a la vez.',
      notes: [
        'Si una Página sale **Reconectar**, vuelve a **+ Añadir Páginas** con un token nuevo y márcala: lo pendiente continúa.',
        '**Quitar** una Página solo cancela lo que esperaba en esa Página; las demás no cambian.',
        'Páginas de **otro** portfolio necesitan su propio usuario del sistema y token: se conectan igual y conviven con las demás.'
      ],
      faqIds: ['varias-paginas']
    },
    {
      id: 'primer-comentario',
      title: 'Primer comentario: añade el permiso pages_manage_engagement',
      optional: true,
      summary: 'Solo si quieres que la Página escriba un comentario justo después de publicar (por ejemplo, con los hashtags). Si no lo usas, salta este paso.',
      actions: [
        'En **developers.facebook.com › Mis apps ›** tu app, abre **Casos de uso** (o **Permisos**) y añade `pages_manage_engagement` igual que añadiste los demás permisos en el **paso 3** (puede cambiar; revisa el portal).',
        'Vuelve al **Business Manager › Usuarios del sistema**, elige tu usuario del sistema y pulsa **Generar token** otra vez.',
        'En la lista de permisos marca **también** `pages_manage_engagement` (además de los de siempre) y genera el token.',
        'En YoutubeMeta, **Conexiones › Facebook**, pulsa **Reconectar** en la Página y pega el token nuevo.',
        'Al publicar, en la pestaña de Facebook escribe el texto en **Primer comentario**.'
      ],
      check: 'Tras una publicación de prueba con primer comentario, el comentario aparece debajo del post, escrito por la Página.',
      notes: [
        'Si el comentario falla, la publicación queda hecha y en **Publicaciones** aparece **Reintentar comentario**: nunca se vuelve a publicar el post por culpa del comentario.'
      ],
      faqIds: ['comentario-falla']
    },
    {
      id: 'bandeja',
      title: 'Bandeja: recibe mensajes y comentarios de la Página',
      optional: true,
      link: { label: 'Abrir Configuración › Bandeja', url: '/settings/inbox' },
      summary: 'Para leer y responder Messenger y los comentarios desde la Bandeja. Publicar no lo necesita.',
      actions: [
        'En tu app de Meta añade los permisos `pages_messaging`, `pages_manage_metadata`, `pages_read_user_content` y `pages_manage_engagement`.',
        'Para recibir mensajes de **cualquier persona** (no solo de quien tiene un rol en la app), Meta exige **revisión de la app** y **verificación del negocio**: pídelas en **Revisión de la app**. Mientras tanto puedes probar con usuarios de prueba.',
        'Genera un **token nuevo** del usuario del sistema con esos permisos y vuelve a conectar la Página (**Conexiones › Facebook › Reconectar**).',
        'Configura la **app de Meta** y el **webhook** (guía de WhatsApp, pasos 5 y 6): en Webhooks elige **Page** y suscribe `messages`, `message_echoes`, `message_deliveries` y `feed`.'
      ],
      check: 'En **Configuración › Bandeja** la Página sale **Recibiendo** y, al escribirle por Messenger, el mensaje llega a la **Bandeja**.',
      notes: ['Messenger solo deja responder **24 h** después del último mensaje de la persona.']
    }
  ],
  faqs: [
    {
      id: 'varias-paginas',
      question: '¿Puedo conectar varias Páginas? ¿Necesito un token por Página?',
      answer: [
        'Sí, todas las que quieras. **Un solo token** del usuario del sistema sirve para todas las Páginas que tenga asignadas (paso 6).',
        'En **+ Añadir Páginas** marca varias a la vez. Para añadir otra más adelante, asígnala al usuario del sistema y vuelve a buscar con el mismo token.',
        'Al publicar eliges en qué Páginas sale el video; la de **★** viene marcada.'
      ],
      stepId: 'cambiar'
    },
    {
      id: 'usuarios-sistema-bloqueado',
      question: 'En «Usuarios del sistema» el botón Añadir está gris y no me deja crear nada',
      symptom: 'Para poder añadir un usuario del sistema, una aplicación debe formar parte de este porfolio empresarial. Añade una aplicación.',
      answer: [
        'Meta exige que exista al menos una **app conectada al portfolio** antes de crear usuarios del sistema.',
        'Haz el **paso 2** (crear la app eligiendo tu portfolio en la sección «Empresa»). Si la app ya existe, conéctala en **Cuentas › Aplicaciones › Añadir › Conectar un identificador de aplicación**.',
        'Cuando la app aparezca en **Cuentas › Aplicaciones**, recarga la página de Usuarios del sistema: el botón pasa a azul.',
        'Si sigue gris, comprueba en **Usuarios › Personas** que tienes **Acceso total**: solo los administradores del portfolio pueden crear usuarios del sistema.'
      ],
      image: {
        src: 'guides/facebook/usuarios-sistema-sin-app.jpg',
        caption: '① El aviso y el botón gris: falta una app en el portfolio. ② Ahí aparecerá la app cuando la conectes (paso 2).'
      },
      stepId: 'app'
    },
    {
      id: 'registro-desarrollador-bloqueado',
      question: 'Al registrarme como desarrollador dice «No puedes hacer el cambio en este momento»',
      symptom:
        'Esto se debe a que estás usando un dispositivo que no usas habitualmente y debemos proteger tu cuenta. Te permitiremos hacer este cambio una vez que hayas utilizado este dispositivo durante un tiempo.',
      answer: [
        'Es un bloqueo de seguridad de Meta, no un error de la plataforma: tu cuenta de Facebook aún no reconoce este navegador o equipo como habitual. No se puede saltar; hay que esperar o usar otro dispositivo.',
        '**Opción rápida:** termina el registro desde el dispositivo donde usas Facebook siempre (tu móvil o tu ordenador habitual). Abre [developers.facebook.com](https://developers.facebook.com/) en el **navegador** de ese dispositivo, con la misma cuenta, y completa *Contact info* y *About you*. Después ya puedes crear la app desde cualquier equipo.',
        '**Si solo puedes usar este equipo:** pulsa **Aceptar**, deja la sesión de Facebook abierta en este navegador y úsalo con normalidad. Si en el móvil te sale «¿Fuiste tú?» sobre este inicio de sesión, confírmalo. Suele desbloquearse en uno o varios días; no repitas el intento muchas veces seguidas, porque puede alargar la espera.',
        '**Alternativa:** otra persona con **Acceso total** al portfolio y cuenta de desarrollador activa puede crear la app eligiendo el portfolio en «Empresa» y hacer también los pasos de permisos y publicación (2 a 4), que se hacen en el panel de desarrollador. El usuario del sistema y el token (pasos 5 a 7) los puedes hacer tú desde Meta Business.',
        'Evita también VPN o navegación privada mientras lo haces: hacen que Meta vea el equipo como «nuevo» cada vez.'
      ],
      stepId: 'app'
    },
    {
      id: 'app-otro-portfolio',
      question: 'Creé la app pero no aparece en mi portfolio',
      answer: [
        'Al crearla no elegiste el portfolio (o elegiste otro). En el panel de la app, **Configuración de la app › Básica**, copia el **Identificador de la app**.',
        'En Meta Business: **Ajustes › Cuentas › Aplicaciones › Añadir › Conectar un identificador de aplicación**, pégalo y confirma.',
        'Si la app ya pertenece a **otro** portfolio, tendrás que pedir acceso a su dueño o crear una nueva app en el tuyo (es gratis y tarda dos minutos).'
      ],
      stepId: 'app'
    },
    {
      id: 'no-veo-pagina',
      question: 'Mi Página no aparece en Cuentas › Páginas',
      answer: [
        'Añádela con **Añadir › Añadir una página existente** (paso 1).',
        'Si Meta dice que pertenece a otro portfolio, usa **Solicitar acceso a una página**; un administrador de ese portfolio debe aprobarlo en **Solicitudes**.',
        'Si no aparece al buscarla, comprueba que es una **Página** y no un perfil, y que tú eres administrador de ella (en la Página: *Configuración › Acceso a la página*).'
      ],
      stepId: 'pagina'
    },
    {
      id: 'perfil-personal',
      question: '¿Puedo publicar en mi perfil personal o en un grupo?',
      answer: [
        'No. Meta retiró la publicación por API en perfiles personales y grupos. Solo se puede publicar en **Páginas**.',
        'Si hoy publicas desde un perfil, crea una Página (es gratis) y añádela al portfolio.'
      ]
    },
    {
      id: 'no-aparecen-permisos',
      question: 'Al generar el token no aparecen los permisos pages_…',
      answer: [
        'Los permisos solo aparecen si están añadidos al **caso de uso** de la app. Haz el **paso 3** y vuelve a pulsar **Generar token**.',
        'Comprueba también que la app es del tipo con caso de uso **«Administrar todo en tu página»**. Una app creada para otro fin (por ejemplo, solo anuncios) no ofrece esos permisos: crea otra app.'
      ],
      stepId: 'permisos'
    },
    {
      id: 'no-aparece-app',
      question: 'Al generar el token mi app no aparece en la lista',
      answer: [
        'El usuario del sistema necesita tener **asignada la app**: en el paso 6, tipo de activo **Aplicaciones**, márcala con «Administrar app».',
        'La app además debe estar conectada al portfolio (paso 2).'
      ],
      stepId: 'activos'
    },
    {
      id: 'pagina-gris',
      question: 'En YoutubeMeta la Página aparece en gris: «sin permiso Crear contenido»',
      answer: [
        'El usuario del sistema ve la Página pero no puede publicar en ella. En el **paso 6** asígnale la Página activando **Contenido** (o «Control total»).',
        'No hace falta generar un token nuevo: vuelve a pulsar **Buscar Páginas**.'
      ],
      stepId: 'activos'
    },
    {
      id: 'lista-vacia',
      question: '«Buscar Páginas» no encuentra ninguna Página',
      answer: [
        'El token es válido pero el usuario del sistema no tiene Páginas asignadas. Haz el **paso 6**.',
        'Si sí la asignaste, comprueba que generaste el token con `pages_show_list` marcado (paso 7).'
      ],
      stepId: 'activos'
    },
    {
      id: 'token-invalido',
      question: '«El token no es válido o caducó»',
      symptom: 'El token no es válido o caducó. Genera uno nuevo en el Business Manager.',
      answer: [
        'Suele ser un **token copiado a medias**: cópialo con el botón «Copiar» de Meta, no seleccionándolo a mano.',
        'También pasa si el token se **revocó**, si se eliminó el usuario del sistema o si se quitó la app del portfolio.',
        'Solución: genera uno nuevo (paso 7). Generar uno nuevo **no** invalida los anteriores.'
      ],
      stepId: 'token'
    },
    {
      id: 'perdi-token',
      question: 'Cerré la ventana y perdí el token',
      answer: [
        'Meta no lo vuelve a mostrar. Genera otro con **Generar token** (paso 7); es inmediato y no afecta a nada.',
        'Si ya estaba conectado en YoutubeMeta no necesitas el token: allí se guardó el de la Página.'
      ],
      stepId: 'token'
    },
    {
      id: 'nadie-ve-video',
      question: 'El video se publicó pero otras personas no lo ven',
      answer: [
        'La app está en modo **desarrollo**: lo publicado solo lo ven quienes tienen un rol en la app.',
        'Haz el **paso 4** (completar datos básicos y publicar la app). Los videos nuevos se verán con normalidad.'
      ],
      stepId: 'publicar-app'
    },
    {
      id: 'app-review',
      question: '¿Necesito App Review o verificar el negocio?',
      answer: [
        'Para publicar en **Páginas de tu propio portfolio**, normalmente no: el acceso estándar es suficiente.',
        'Solo haría falta si la app fuera a publicar en Páginas de **otras** empresas o si Meta lo pide expresamente en el panel de la app.'
      ]
    },
    {
      id: 'limite-usuarios-sistema',
      question: 'Meta dice que alcancé el límite de usuarios del sistema',
      answer: [
        'Los portfolios tienen un número limitado de usuarios del sistema. Reutiliza uno existente: no hace falta uno nuevo por app ni por Página.',
        'Asígnale la Página y la app (paso 6) y genera su token (paso 7).'
      ]
    },
    {
      id: 'caduca',
      question: '¿El token caduca? ¿Qué lo invalida?',
      answer: [
        'Con caducidad **«Nunca»** no caduca. Deja de funcionar si se elimina el usuario del sistema, se le quita la Página o la app, se elimina la app o alguien lo revoca.',
        'En ese caso la tarjeta de Facebook muestra **Reconectar**: repite el paso 7 y el 8.'
      ]
    },
    {
      id: 'cambiar-pendientes',
      question: '¿Qué pasa con lo programado si cambio de Página?',
      answer: [
        'Las publicaciones que **esperaban** turno con la Página anterior se cancelan, porque se configuraron para esa Página. Las ya publicadas no se tocan.',
        'Si vuelves a conectar la **misma** Página (por ejemplo, con un token nuevo), lo pendiente continúa.'
      ],
      stepId: 'cambiar'
    },
    {
      id: 'comentario-falla',
      question: 'El post se publicó pero el primer comentario no aparece',
      symptom: 'No se pudo poner el comentario',
      answer: [
        'Casi siempre falta el permiso `pages_manage_engagement` en el token del usuario del sistema. Genera un token nuevo con ese permiso marcado y reconecta la Página (paso «Primer comentario»).',
        'Después pulsa **Reintentar comentario** en Publicaciones: solo se envía el comentario.'
      ],
      stepId: 'primer-comentario'
    }
  ]
};
