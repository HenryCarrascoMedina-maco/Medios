import { BUSINESS, businessMenu } from './facebook.guide';
import { IGuide } from './guide.models';

export const INSTAGRAM_GUIDE: IGuide = {
  platform: 'instagram',
  title: 'Conectar cuentas de Instagram',
  intro:
    'Instagram publica **Reels** por API con la misma infraestructura de Meta que Facebook: la **app** del portfolio y el **usuario del sistema**. ' +
    'Si ya conectaste Facebook, solo faltan tres cosas: que la cuenta sea **profesional**, que esté **vinculada a una Página** y que el token tenga los **permisos de Instagram**.',
  duration: '10 minutos si Facebook ya está conectado; 30 minutos desde cero',
  requirements: [
    'Una cuenta de Instagram **profesional** (Empresa o Creador). Las cuentas personales no publican por API.',
    'Una **Página de Facebook** vinculada a esa cuenta de Instagram y dentro de tu portfolio empresarial.',
    'La **app** de Meta y el **usuario del sistema** de la guía de Facebook (pasos 1 a 6). Si Meta te bloquea el registro de desarrollador, revisa esa guía.'
  ],
  steps: [
    {
      id: 'profesional',
      title: 'Pasa la cuenta de Instagram a profesional',
      summary: 'Se hace en la app de Instagram del móvil. Es gratis y se puede volver atrás.',
      actions: [
        'En Instagram abre tu perfil › **☰ Menú › Configuración y actividad**.',
        'Entra en **Tipo de cuenta y herramientas › Cambiar a cuenta profesional**.',
        'Elige **Empresa** (o **Creador**), una categoría y pulsa **Listo**.'
      ],
      shot: {
        url: 'Instagram (app) › Configuración y actividad',
        title: 'Tipo de cuenta y herramientas',
        blocks: [
          { kind: 'row', label: 'Cambiar a cuenta profesional', mark: 2 },
          { kind: 'option', label: 'Empresa', sub: 'Tiendas, marcas, organizaciones', checked: true, mark: 3 },
          { kind: 'option', label: 'Creador', sub: 'Figuras públicas, artistas', checked: false }
        ]
      },
      check: 'En tu perfil aparece el botón **Panel profesional**.',
      faqIds: ['cuenta-personal']
    },
    {
      id: 'vincular',
      title: 'Vincula la cuenta a una Página de Facebook',
      link: { label: 'Abrir Meta Business', url: 'https://business.facebook.com/latest/settings/instagram_account' },
      summary: 'La API de Instagram llega a la cuenta **a través de la Página** a la que está vinculada.',
      actions: [
        'En Instagram: **Editar perfil › Página** y elige la Página de Facebook (o créala).',
        'O desde la Página de Facebook: **Configuración › Cuentas vinculadas › Instagram › Conectar cuenta**.',
        'Comprueba que esa Página está en tu portfolio (paso 1 de la guía de Facebook).'
      ],
      shot: {
        url: 'Instagram (app) › Editar perfil',
        title: 'Editar perfil',
        blocks: [
          { kind: 'field', label: 'Nombre de usuario', value: 'tumarca' },
          { kind: 'row', label: 'Página', sub: 'Tu Página de Facebook', mark: 1, selected: true }
        ]
      },
      check: 'En **Editar perfil › Página** aparece el nombre de tu Página.',
      faqIds: ['no-aparece-cuenta']
    },
    {
      id: 'portfolio',
      title: 'Añade la cuenta de Instagram al portfolio',
      link: { label: 'Abrir Cuentas de Instagram', url: 'https://business.facebook.com/latest/settings/instagram_account' },
      summary: 'Así podrás asignarla al usuario del sistema en el paso 5.',
      actions: [
        'En **Meta Business › Ajustes › Cuentas › Cuentas de Instagram** pulsa **Añadir**.',
        'Inicia sesión con la cuenta de Instagram cuando te lo pida.',
        'Acepta. La cuenta queda en la lista.'
      ],
      shot: {
        url: `${BUSINESS}/instagram_account`,
        sidebar: businessMenu('Cuentas de Instagram', 1),
        title: 'Cuentas de Instagram',
        buttons: [{ label: '+ Añadir', primary: true, mark: 1 }],
        blocks: [{ kind: 'row', label: '@tumarca', sub: 'Vinculada a: Tu Página', mark: 3 }]
      },
      check: 'Tu cuenta aparece en **Cuentas de Instagram** con su Página vinculada.'
    },
    {
      id: 'permisos',
      title: 'Añade los permisos de Instagram a la app',
      link: { label: 'Abrir Mis apps', url: 'https://developers.facebook.com/apps/' },
      summary: 'La misma app de Facebook sirve: solo hay que sumarle dos permisos.',
      actions: [
        'En **developers.facebook.com › Mis apps** abre tu app.',
        '**Casos de uso › Administrar todo en tu página › Personalizar › Permisos**.',
        'Pulsa **Añadir** en `instagram_basic` e `instagram_content_publish` (y deja `pages_show_list` y `pages_read_engagement`).',
        'Si no aparecen ahí, en **Casos de uso › Añadir caso de uso** elige **«Administrar mensajes y contenido en Instagram»** con la opción **«API con inicio de sesión con Facebook»** y añade los mismos permisos.'
      ],
      shot: {
        url: 'developers.facebook.com/apps/…/use_cases/customize',
        sidebar: [{ label: 'Panel' }, { label: 'Casos de uso', active: true }, { label: 'Configuración de la app' }, { label: 'Publicar' }],
        title: 'Permisos y funciones',
        blocks: [
          { kind: 'row', label: 'instagram_basic', sub: 'Listo para las pruebas', button: 'Añadir', mark: 3 },
          { kind: 'row', label: 'instagram_content_publish', sub: 'Listo para las pruebas', button: 'Añadir', mark: 3 },
          { kind: 'row', label: 'pages_show_list', sub: 'Añadido', selected: true },
          { kind: 'row', label: 'pages_read_engagement', sub: 'Añadido', selected: true }
        ]
      },
      check: 'Los cuatro permisos aparecen como **Añadido**.',
      notes: ['Para publicar en **tus propias** cuentas basta con el acceso estándar: no hace falta la revisión de la app (App Review).'],
      faqIds: ['no-aparecen-permisos']
    },
    {
      id: 'activos',
      title: 'Asigna la cuenta de Instagram al usuario del sistema',
      link: { label: 'Abrir Usuarios del sistema', url: 'https://business.facebook.com/latest/settings/system_users' },
      summary: 'El mismo usuario del sistema de Facebook (`youtubemeta-publicador`).',
      actions: [
        '**Ajustes › Usuarios del sistema** › elige `youtubemeta-publicador` › **Asignar activos**.',
        'Tipo **Cuentas de Instagram** › marca tu cuenta › activa **Contenido** (o **Control total**).',
        'Comprueba que su **Página** también está asignada con **Contenido** (paso 6 de Facebook). Pulsa **Asignar activos**.'
      ],
      shot: {
        url: `${BUSINESS}/system_users`,
        sidebar: businessMenu('Usuarios del sistema', 1),
        title: 'Asignar activos · youtubemeta-publicador',
        blocks: [
          { kind: 'heading', text: 'Cuentas de Instagram' },
          { kind: 'check', label: '@tumarca', checked: true, mark: 2 },
          { kind: 'check', label: 'Contenido · publicar y administrar', checked: true, mark: 2 }
        ],
        buttons: [{ label: 'Asignar activos', primary: true, mark: 3 }]
      },
      check: 'En el usuario del sistema, pestaña **Activos**, aparecen la cuenta de Instagram y su Página.',
      faqIds: ['no-aparece-cuenta']
    },
    {
      id: 'token',
      title: 'Genera un token con los permisos de Instagram',
      link: { label: 'Abrir Usuarios del sistema', url: 'https://business.facebook.com/latest/settings/system_users' },
      summary: 'Un token que ya tenías no gana permisos nuevos: hay que generar otro.',
      actions: [
        'En `youtubemeta-publicador` pulsa **Generar token**.',
        'Elige tu **app** y caducidad **Nunca**.',
        'Marca `pages_show_list`, `pages_read_engagement`, `instagram_basic` e `instagram_content_publish` (y `pages_manage_posts` si también lo usarás para Facebook).',
        'Pulsa **Generar token** y cópialo.'
      ],
      shot: {
        url: `${BUSINESS}/system_users`,
        sidebar: businessMenu('Usuarios del sistema', 1),
        title: 'Generar token',
        blocks: [
          { kind: 'field', label: 'Aplicación', value: 'YoutubeMeta Publicador', mark: 2 },
          { kind: 'field', label: 'Caducidad del token', value: 'Nunca', mark: 2 },
          { kind: 'check', label: 'instagram_basic', checked: true, mark: 3 },
          { kind: 'check', label: 'instagram_content_publish', checked: true, mark: 3 },
          { kind: 'check', label: 'pages_show_list', checked: true, mark: 3 },
          { kind: 'check', label: 'pages_read_engagement', checked: true, mark: 3 },
          { kind: 'secret', label: 'EAAG…', mark: 4 }
        ]
      },
      check: 'Tienes copiado un texto largo que empieza por `EAA`.',
      notes: ['A diferencia de Facebook, YoutubeMeta **guarda este token cifrado**: Instagram publica con él. Si lo regeneras, vuelve a conectar las cuentas.'],
      faqIds: ['faltan-permisos', 'mismo-token']
    },
    {
      id: 'conectar',
      title: 'Conéctalas en YoutubeMeta',
      summary: 'Aquí, en **Conexiones**.',
      actions: [
        'En la tarjeta de Instagram pulsa **+ Añadir cuentas**.',
        'Pega el token y pulsa **Buscar cuentas de Instagram**.',
        'Marca **una o varias** cuentas y pulsa **Conectar**.',
        'Pulsa **Probar**: muestra cuántas publicaciones por API llevas hoy y el máximo de Meta.'
      ],
      shot: {
        url: 'YoutubeMeta › Conexiones',
        title: 'Conectar cuentas de Instagram',
        blocks: [
          { kind: 'secret', label: 'EAAG…', mark: 2 },
          { kind: 'check', label: 'Tu Marca @tumarca · Página: Tu Página', checked: true, mark: 3 },
          { kind: 'note', tone: 'ok', text: 'Conexión correcta con @tumarca. Publicaciones por API en 24 h: 0 de 50.' }
        ],
        buttons: [{ label: 'Buscar cuentas de Instagram', mark: 2 }, { label: 'Conectar 1', primary: true, mark: 3 }]
      },
      check: 'La tarjeta de Instagram muestra la cuenta con **Conectada**.',
      faqIds: ['no-aparece-cuenta', 'faltan-permisos']
    },
    {
      id: 'publicar',
      title: 'Cómo se publica en Instagram',
      summary: 'Desde el detalle de un video: **Publicar en varias cuentas** y marca la cuenta de Instagram.',
      actions: [
        'El video se publica como **Reel**. El **texto** es la descripción (hasta 2200 caracteres, 30 hashtags y 20 menciones).',
        '**Mostrar también en el feed** (activado por defecto): el Reel sale en el perfil además de en la pestaña Reels.',
        '**Programar**: Instagram no programa por API; YoutubeMeta lo publica a la hora indicada.',
        'Tras subirlo, Meta lo procesa unos minutos y YoutubeMeta lo publica solo. El enlace aparece en el detalle.'
      ],
      check: 'En **Publicaciones** la fila pasa a **Publicado** con el enlace al Reel.',
      notes: ['Requisitos de Meta para Reels: MP4 o MOV, H.264, de **3 s a 15 min**, hasta **300 MB**, ideal vertical 9:16. YoutubeMeta avisa antes de enviar si no se cumplen.'],
      faqIds: ['formato', 'limite-diario']
    },
    {
      id: 'cambiar',
      title: 'Más cuentas, ★ por defecto y quitar',
      optional: true,
      summary: 'Repite los pasos 1 a 3 y 5 para cada cuenta nueva; el token del paso 6 vale para todas las asignadas.',
      actions: [
        '**+ Añadir cuentas** con el mismo token y marca las nuevas.',
        '**★ Marcar por defecto** para la que venga elegida al publicar; **✎ Nombre corto** para distinguirlas.',
        '**Quitar** borra el token de esa cuenta y cancela solo lo pendiente en ella.'
      ],
      check: 'Cada cuenta aparece en su fila dentro de la tarjeta de Instagram.'
    },
    {
      id: 'primer-comentario',
      title: 'Primer comentario: añade el permiso instagram_manage_comments',
      optional: true,
      summary: 'Solo si quieres que tu cuenta comente justo después de publicar (por ejemplo, para dejar ahí los hashtags y el texto limpio).',
      actions: [
        'En tu app de Meta añade el permiso `instagram_manage_comments` igual que los demás del **paso 4** (puede cambiar; revisa el portal).',
        'En el **Business Manager › Usuarios del sistema** genera un token nuevo marcando también `instagram_manage_comments`.',
        'En YoutubeMeta, **Conexiones › Instagram**, pulsa **Reconectar** en la cuenta y pega el token nuevo.',
        'Al publicar, escribe el texto en **Primer comentario** dentro de la pestaña de Instagram.'
      ],
      check: 'En una publicación de prueba, el comentario aparece el primero, escrito por tu cuenta.',
      notes: [
        'Meta no siempre permite comentar por API en todas las cuentas: pruébalo con la tuya antes de contar con ello.',
        'Si el comentario falla, el post queda publicado y puedes pulsar **Reintentar comentario** en Publicaciones.'
      ],
      faqIds: ['comentario-falla']
    },
    {
      id: 'imagenes',
      title: 'Publicar imágenes y carruseles: hace falta un dominio público',
      optional: true,
      summary: 'Instagram no recibe las imágenes como archivo: las descarga desde una dirección pública de YoutubeMeta.',
      actions: [
        'Publica YoutubeMeta en un servidor con dominio propio y **https** (por ejemplo, en IIS con certificado).',
        'Pide a quien administra el servidor que configure `App:PublicBaseUrl` con esa dirección (por ejemplo `https://publicar.tuempresa.com`).',
        'Reinicia la aplicación. En el diálogo de publicación, Instagram dejará de mostrar «necesita que la app esté publicada en un dominio (dirección pública)».'
      ],
      check: 'Al elegir imágenes, la cuenta de Instagram aparece disponible en «¿Dónde se publica?».',
      notes: ['En tu ordenador (localhost) Instagram no puede descargar nada: los videos sí funcionan, las imágenes no.', 'Un carrusel admite hasta 10 imágenes (lo indica el servidor).']
    },
    {
      id: 'bandeja',
      title: 'Bandeja: recibe mensajes directos y comentarios',
      optional: true,
      link: { label: 'Abrir Configuración › Bandeja', url: '/settings/inbox' },
      summary: 'Para leer y responder los DM y los comentarios desde la Bandeja. Publicar no lo necesita.',
      actions: [
        'En la app de **Instagram** del móvil: **Configuración › Mensajes y respuestas a historias › Herramientas conectadas** › activa **Permitir acceso a los mensajes**.',
        'En tu app de Meta añade `instagram_manage_messages`, `instagram_manage_comments` y `pages_messaging`. Para mensajes de cualquier persona Meta exige **revisión de la app**.',
        'Genera un **token nuevo** con esos permisos y vuelve a conectar la cuenta (**Conexiones › Instagram › Reconectar**).',
        'Configura la **app de Meta** y el **webhook** (guía de WhatsApp, pasos 5 y 6): en Webhooks elige **Instagram** y suscribe `messages` y `comments`.'
      ],
      check: 'En **Configuración › Bandeja** la cuenta sale **Recibiendo** y un DM de prueba llega a la **Bandeja**.',
      notes: ['Los DM solo se pueden responder **24 h** después del último mensaje de la persona.']
    }
  ],
  faqs: [
    {
      id: 'cuenta-personal',
      question: 'Mi cuenta es personal: ¿puedo publicar igual?',
      answer: [
        'No. Meta solo permite publicar por API en cuentas **profesionales** (Empresa o Creador). Haz el **paso 1**: no pierdes seguidores ni publicaciones.'
      ],
      stepId: 'profesional'
    },
    {
      id: 'no-aparece-cuenta',
      question: '«Ninguna Página asignada tiene una cuenta profesional de Instagram vinculada»',
      symptom: 'Ninguna Página asignada al usuario del sistema tiene una cuenta profesional de Instagram vinculada.',
      answer: [
        'YoutubeMeta busca las cuentas de Instagram **a través de las Páginas** que tiene asignadas el usuario del sistema. Revisa, en orden:',
        '1) la cuenta es profesional (paso 1); 2) está vinculada a una Página (paso 2); 3) esa Página está asignada al usuario del sistema con **Contenido** (paso 6 de Facebook); 4) la cuenta de Instagram también está asignada (paso 5).',
        'Después genera un token nuevo (paso 6) y vuelve a buscar.'
      ],
      stepId: 'vincular'
    },
    {
      id: 'faltan-permisos',
      question: '«Al token le faltan los permisos instagram_basic, instagram_content_publish»',
      symptom: 'Al token le faltan los permisos instagram_basic, instagram_content_publish.',
      answer: [
        'El token se generó sin marcar los permisos de Instagram, o la app aún no los tenía. Haz el **paso 4** y genera un token **nuevo** (paso 6): un token viejo no gana permisos.'
      ],
      stepId: 'token'
    },
    {
      id: 'no-aparecen-permisos',
      question: 'No me aparecen los permisos de Instagram al generar el token',
      answer: [
        'La app todavía no tiene esos permisos en su caso de uso. Haz el **paso 4** y recarga la pantalla de **Generar token**.',
        'Si tampoco aparecen en el caso de uso, añade el caso **«Administrar mensajes y contenido en Instagram»** eligiendo la variante **con inicio de sesión con Facebook**.'
      ],
      stepId: 'permisos'
    },
    {
      id: 'mismo-token',
      question: '¿Puedo usar el mismo token para Facebook e Instagram?',
      answer: [
        'Sí, si lo generas con todos los permisos: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic` e `instagram_content_publish`.',
        'Facebook no guarda ese token (guarda el de cada Página); Instagram sí lo guarda cifrado. Si lo regeneras, reconecta las cuentas de Instagram.'
      ],
      stepId: 'token'
    },
    {
      id: 'formato',
      question: '«Instagram no admite el formato del video» o el Reel falla al procesarse',
      answer: [
        'Reels por API: MP4 o MOV, vídeo **H.264** (o HEVC) y audio **AAC**, de **3 s a 15 min**, hasta **300 MB**, de 23 a 60 fps y como mucho 1920 px de ancho.',
        'Si el archivo viene de un móvil o una cámara con otro códec, recodifícalo a MP4 (H.264 + AAC) y súbelo otra vez a la biblioteca.'
      ],
      stepId: 'publicar'
    },
    {
      id: 'limite-diario',
      question: '«Instagram alcanzó su límite de publicaciones por API en 24 h»',
      answer: [
        'Meta limita cuántas publicaciones hace cada cuenta por API en 24 h (hoy entre 50 y 100; **Probar** muestra el número exacto de tu cuenta).',
        'La publicación queda **Esperando cuota** y se reintenta sola cada hora. No hace falta hacer nada.'
      ],
      stepId: 'publicar'
    },
    {
      id: 'restringida',
      question: '«La cuenta de Instagram está restringida»',
      answer: ['Instagram limitó la cuenta (normas, actividad sospechosa o verificación pendiente). Abre la app de Instagram con esa cuenta y sigue sus avisos; luego reintenta la publicación.']
    },
    {
      id: 'ppa',
      question: 'Meta pide «autorización de publicación de la Página» o verificación en dos pasos',
      answer: [
        'Algunas Páginas exigen **Autorización de publicación de la Página (PPA)** o que los administradores tengan la **verificación en dos pasos**. Sin eso Meta rechaza la publicación en la cuenta de Instagram vinculada.',
        'Complétalo desde la Página de Facebook (**Configuración › Autorizaciones de publicación**) y en tu cuenta personal (**Centro de cuentas › Contraseña y seguridad**).'
      ]
    },
    {
      id: 'solo-reels',
      question: '¿Se pueden publicar fotos, carruseles o historias?',
      answer: [
        'Sí: videos (como **Reels**), una imagen o un **carrusel** de varias imágenes. Las historias no están incluidas.',
        'Para imágenes y carruseles, YoutubeMeta tiene que estar publicada en un dominio público (paso «Publicar imágenes y carruseles»).'
      ],
      stepId: 'imagenes'
    },
    {
      id: 'bloqueo-desarrollador',
      question: 'Meta no me deja registrarme como desarrollador («No puedes hacer el cambio en este momento»)',
      answer: [
        'Es el mismo bloqueo que con Facebook: Instagram usa la misma cuenta de desarrollador y la misma app.',
        'Abre la **guía de Facebook › Preguntas frecuentes** y busca «No puedes hacer el cambio»: ahí están las tres salidas (usar un contacto ya confirmado, generar actividad o que otra persona cree la app).'
      ]
    },
    {
      id: 'comentario-falla',
      question: 'El post se publicó pero el primer comentario no aparece',
      symptom: 'No se pudo poner el comentario',
      answer: [
        'Falta el permiso `instagram_manage_comments` en el token, o Meta no lo permite en esa cuenta.',
        'Genera un token con ese permiso, reconecta la cuenta y pulsa **Reintentar comentario** en Publicaciones.'
      ],
      stepId: 'primer-comentario'
    },
    {
      id: 'dominio-publico',
      question: '«Necesita que la app esté publicada en un dominio (dirección pública)»',
      symptom: 'necesita que la app esté publicada en un dominio',
      answer: [
        'Instagram descarga las imágenes desde una dirección pública. Mientras YoutubeMeta funcione solo en tu ordenador o sin `App:PublicBaseUrl`, no puede publicar imágenes.',
        'Los videos (Reels) sí funcionan porque se envían como archivo.'
      ],
      stepId: 'imagenes'
    }
  ]
};
