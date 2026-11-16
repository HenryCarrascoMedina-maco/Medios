import { IGuide, IShotNavItem } from './guide.models';

/** Menú de una app en Microsoft Entra › Registros de aplicaciones. */
function appMenu(active: string, mark?: number): IShotNavItem[] {
  const items = ['Información general', 'Autenticación', 'Certificados y secretos', 'Permisos de API'];
  return items.map(label => (label === active ? { label, active: true, mark } : { label }));
}

const LABELS_MAY_CHANGE = 'Microsoft cambia a veces los nombres de los menús y botones (pueden cambiar). Si no encuentras uno, busca uno parecido en la misma pantalla; si tu portal está en inglés, el nombre en inglés va entre paréntesis.';

export const TEAMS_GUIDE: IGuide = {
  platform: 'teams',
  title: 'Conectar canales de Microsoft Teams',
  intro:
    'En Teams se publica en **canales** de tus equipos. Hay **dos formas**: ' +
    '**(A) Microsoft Graph**, la recomendada: inicias sesión con tu cuenta de trabajo, eliges los canales y se puede publicar texto, imágenes, video y PDF con tu nombre; ' +
    'y **(B) webhook con Workflows**, para cuando tu organización no deja registrar apps: se hace canal a canal y solo admite texto, enlaces e imágenes. ' +
    'Haz la A si puedes. Si en el camino Microsoft pide «aprobación del administrador», el **paso 6** trae un mensaje listo para enviar a tu equipo de TI, y mientras tanto puedes usar la B.',
  duration: 'Forma A: unos 10–15 minutos. Forma B: unos 3 minutos por canal',
  requirements: [
    'Una cuenta de **trabajo o escuela** de Microsoft 365 (por ejemplo `nombre@tuempresa.com`). Las cuentas personales (`@outlook.com`, `@hotmail.com`) **no sirven**.',
    'Ser miembro de los equipos y canales donde quieres publicar, con permiso para escribir en ellos.',
    'Acceso a **Ajustes › Plataformas** y a **Conexiones** en YoutubeMeta.'
  ],
  steps: [
    // ── FORMA A · MICROSOFT GRAPH ─────────────────────────────────────────
    {
      id: 'cuenta',
      title: 'Forma A · Comprueba que tu cuenta es de trabajo o escuela',
      summary: 'Teams publica como una persona de la organización, así que hace falta una cuenta de la empresa.',
      actions: [
        'Abre Teams (la aplicación o [teams.microsoft.com](https://teams.microsoft.com)).',
        'Pulsa tu foto (arriba a la derecha) y mira el correo con el que entraste.',
        'Si termina en el dominio de tu empresa o escuela (por ejemplo `@tuempresa.com`), puedes seguir.',
        'Si termina en `@outlook.com`, `@hotmail.com` o `@live.com`, es una cuenta personal: no funciona para esto. Entra con la cuenta que te dio tu organización.'
      ],
      check: 'Ves tus equipos y canales de la empresa en Teams con una cuenta de trabajo.',
      faqIds: ['cuenta-personal']
    },
    {
      id: 'registro',
      title: 'Registra la app en Microsoft Entra',
      link: { label: 'Abrir Registros de aplicaciones', url: 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade' },
      summary: 'La «app» es la ficha que Microsoft enseña cuando alguien conecta YoutubeMeta. Es gratis y se hace una sola vez por organización.',
      copy: 'teamsRedirectUri',
      actions: [
        'Entra en **entra.microsoft.com** con tu cuenta de trabajo.',
        'En el menú de la izquierda abre **Aplicaciones › Registros de aplicaciones** (App registrations) y pulsa **Nuevo registro** (New registration).',
        '**Nombre**: `YoutubeMeta`.',
        '**Tipos de cuenta compatibles**: elige **Solo cuentas de este directorio organizativo** (Accounts in this organizational directory only).',
        '**URI de redirección**: en la lista elige **Web** y pega este valor (también está en **Ajustes › Plataformas › Teams** con su botón Copiar): `{{teamsRedirectUri}}`. Si ves «…», guarda primero algo en Ajustes y vuelve.',
        'Pulsa **Registrar** (Register).'
      ],
      shot: {
        url: 'entra.microsoft.com › Registros de aplicaciones › Nuevo registro',
        title: 'Registrar una aplicación',
        blocks: [
          { kind: 'field', label: 'Nombre', value: 'YoutubeMeta', mark: 3 },
          { kind: 'option', label: 'Solo cuentas de este directorio organizativo', sub: 'Inquilino único', checked: true, mark: 4 },
          { kind: 'field', label: 'URI de redirección · Web', value: 'https://…/api/Connection/Teams/Callback', mark: 5 }
        ],
        buttons: [{ label: 'Registrar', primary: true, mark: 6 }]
      },
      check: 'Ves la página **Información general** de la app YoutubeMeta.',
      notes: [LABELS_MAY_CHANGE, 'Si el botón «Nuevo registro» no aparece o da error de permisos, tu organización no deja registrar apps: ve al **paso 6** (Si necesitas a TI) o usa la forma B.'],
      faqIds: ['no-puedo-registrar']
    },
    {
      id: 'ids',
      title: 'Copia el Id. de aplicación y el Id. de directorio',
      summary: 'Son dos códigos largos con guiones. YoutubeMeta los necesita para iniciar sesión en tu organización.',
      actions: [
        'En **Información general** (Overview) de la app copia el **Id. de aplicación (cliente)** (Application (client) ID) con el icono de copiar que aparece al pasar el ratón.',
        'En YoutubeMeta abre **Ajustes › Plataformas › Microsoft Teams** y pégalo en **Id. de aplicación (cliente)**.',
        'Vuelve a Entra y copia el **Id. de directorio (inquilino)** (Directory (tenant) ID).',
        'Pégalo en **Id. de directorio (inquilino)** en YoutubeMeta. Todavía no pulses Guardar: falta el secreto (paso siguiente).'
      ],
      shot: {
        url: 'entra.microsoft.com › YoutubeMeta › Información general',
        sidebar: appMenu('Información general'),
        title: 'Información esencial',
        blocks: [
          { kind: 'field', label: 'Id. de aplicación (cliente)', value: '1a2b3c4d-…', mark: 1 },
          { kind: 'field', label: 'Id. de directorio (inquilino)', value: '9f8e7d6c-…', mark: 3 }
        ]
      },
      check: 'En Ajustes los dos campos tienen el formato `00000000-0000-0000-0000-000000000000`.'
    },
    {
      id: 'secreto',
      title: 'Crea el secreto y copia su VALOR al momento',
      summary: 'El secreto es como la contraseña de la app. Microsoft solo lo enseña una vez.',
      actions: [
        'En el menú de la app abre **Certificados y secretos** (Certificates & secrets) › pestaña **Secretos de cliente** › **Nuevo secreto de cliente** (New client secret).',
        '**Descripción**: `YoutubeMeta`. **Expira**: **24 meses**. Pulsa **Agregar**.',
        'En la lista aparece el secreto con dos columnas: **Valor** e **Id. del secreto**. Copia el **Valor** (Value) **ahora mismo**: al salir de la página Microsoft lo oculta para siempre.',
        'En YoutubeMeta pégalo en **Secreto** y, en **Caduca el secreto**, pon la fecha de la columna **Expira**.',
        'Pulsa **Guardar**.'
      ],
      shot: {
        url: 'entra.microsoft.com › YoutubeMeta › Certificados y secretos',
        sidebar: appMenu('Certificados y secretos', 1),
        title: 'Secretos de cliente',
        blocks: [
          { kind: 'row', label: 'YoutubeMeta', sub: 'Expira: dentro de 24 meses' },
          { kind: 'secret', label: 'Valor', mark: 3 },
          { kind: 'note', text: 'Copia el Valor, no el «Id. del secreto».', tone: 'warn' }
        ]
      },
      check: 'La tarjeta **Microsoft Teams** de Ajustes dice **Guardada aquí**.',
      notes: ['YoutubeMeta te avisa un mes antes de que caduque el secreto. Para renovarlo, crea uno nuevo aquí, pégalo en Ajustes con su nueva fecha y borra el viejo.'],
      faqIds: ['secreto-invalido']
    },
    {
      id: 'permisos',
      title: 'Añade los permisos de Microsoft Graph',
      summary: 'Son permisos «delegados»: la app solo actúa como tú y solo donde tú ya puedes escribir.',
      actions: [
        'En el menú de la app abre **Permisos de API** (API permissions) › **Agregar un permiso** (Add a permission) › **Microsoft Graph** › **Permisos delegados** (Delegated permissions).',
        'Busca y marca uno a uno: `ChannelMessage.Send`, `Team.ReadBasic.All`, `Channel.ReadBasic.All`, `Files.ReadWrite.All`, `User.Read` y `offline_access`.',
        'Pulsa **Agregar permisos** (Add permissions).',
        'Si aparece el botón **Conceder consentimiento de administrador para…** (Grant admin consent for…) y puedes pulsarlo, púlsalo y confirma con **Sí**.',
        'Si ese botón está gris o te da error, no pasa nada: ve al **paso 6**.'
      ],
      shot: {
        url: 'entra.microsoft.com › YoutubeMeta › Permisos de API',
        sidebar: appMenu('Permisos de API', 1),
        title: 'Permisos configurados',
        blocks: [
          { kind: 'check', label: 'ChannelMessage.Send · Delegado', checked: true, mark: 2 },
          { kind: 'check', label: 'Team.ReadBasic.All · Delegado', checked: true, mark: 2 },
          { kind: 'check', label: 'Channel.ReadBasic.All · Delegado', checked: true, mark: 2 },
          { kind: 'check', label: 'Files.ReadWrite.All · Delegado', checked: true, mark: 2 },
          { kind: 'check', label: 'User.Read · Delegado', checked: true, mark: 2 },
          { kind: 'check', label: 'offline_access · Delegado', checked: true, mark: 2 }
        ],
        buttons: [{ label: 'Conceder consentimiento de administrador', mark: 4 }]
      },
      check: 'Los seis permisos aparecen en la lista. Si pudiste conceder el consentimiento, la columna **Estado** muestra una marca verde.',
      notes: ['`Files.ReadWrite.All` sirve para guardar los videos y PDF en «Archivos» del canal. `offline_access` mantiene la conexión sin pedirte entrar cada día.', LABELS_MAY_CHANGE]
    },
    {
      id: 'ti',
      title: 'Si necesitas a TI: envía este mensaje',
      optional: true,
      summary: 'Muchas organizaciones exigen que un administrador apruebe las apps. Copia este texto y envíalo a tu equipo de TI.',
      actions: [
        'Copia el mensaje de abajo (ya lleva el enlace de aprobación con los datos que guardaste en Ajustes).',
        'Envíalo por correo o por Teams a tu equipo de TI.',
        'Cuando te digan que está aprobado, sigue con el **paso 7**. Mientras tanto puedes conectar canales con la **forma B** (webhook).',
        'Mensaje: «Hola. Uso YoutubeMeta, la herramienta interna para publicar contenido de la empresa. Registré en Entra la app **YoutubeMeta** (Id. de aplicación `{{teamsClientId}}`) para publicar en canales de Teams. Pide solo **permisos delegados**: ChannelMessage.Send, Team.ReadBasic.All, Channel.ReadBasic.All, Files.ReadWrite.All, User.Read y offline_access. Delegados significa que la app actúa únicamente como la persona que inicia sesión y solo en los canales donde esa persona ya puede escribir; no lee correos ni chats. ¿Podéis aprobarla con este enlace? https://login.microsoftonline.com/{{teamsTenantId}}/adminconsent?client_id={{teamsClientId}} Gracias.»'
      ],
      check: 'TI te confirma que concedió el consentimiento, o en **Permisos de API** la columna **Estado** aparece en verde.',
      notes: ['Si el enlace sale con «…», guarda antes el Id. de aplicación y el Id. de directorio en Ajustes y recarga esta guía.'],
      faqIds: ['aprobacion']
    },
    {
      id: 'conectar',
      title: 'Conecta Teams y elige los canales',
      summary: 'Ya puedes conectar: inicias sesión con Microsoft y marcas en qué canales se publica.',
      actions: [
        'En YoutubeMeta abre **Conexiones** y busca la tarjeta **Teams**.',
        'Pulsa **Conectar Teams**. Se abre la pantalla de inicio de sesión de Microsoft.',
        'Entra con tu cuenta de trabajo y pulsa **Aceptar** en la pantalla de permisos.',
        'De vuelta en YoutubeMeta verás tus equipos y canales. Marca los canales donde quieres publicar (los privados avisan de que tienes que ser miembro) y pulsa **Conectar**.'
      ],
      shot: {
        url: 'localhost:4200/connections',
        title: 'Elige los canales de Teams',
        blocks: [
          { kind: 'heading', text: 'Marketing' },
          { kind: 'check', label: '# General', checked: true, mark: 4 },
          { kind: 'check', label: '# Lanzamientos', checked: true, mark: 4 },
          { kind: 'check', label: '# Diseño · privado', checked: false }
        ],
        buttons: [{ label: 'Conectar 2', primary: true, mark: 4 }]
      },
      check: 'Cada canal aparece en la tarjeta de Teams como **Conectada**, con el nombre «Equipo › Canal».',
      faqIds: ['aprobacion', 'cuenta-personal', 'sin-equipos']
    },
    {
      id: 'probar',
      title: 'Prueba con una publicación real',
      summary: 'Comprueba que llega antes de programar algo importante.',
      actions: [
        'Ve a **Medios** y pulsa **Nueva publicación**.',
        'Escribe un título (en Teams es el **asunto** del mensaje) y un texto corto, por ejemplo «Prueba».',
        'En **¿Dónde se publica?** marca uno de tus canales de Teams. Deja sin marcar **Avisar a todo el canal (@canal)** para no molestar.',
        'Marca el consentimiento y pulsa **Publicar**. En **Publicaciones** verás cuándo termina.'
      ],
      check: 'El mensaje aparece en el canal con tu nombre. Puedes borrarlo desde Teams (⋯ › Eliminar).'
    },

    // ── FORMA B · WEBHOOK ─────────────────────────────────────────────────
    {
      id: 'webhook-canal',
      title: 'Forma B · Abre el canal y entra en Flujos de trabajo',
      summary: 'Para cuando no puedes registrar apps. Se hace una vez por canal.',
      actions: [
        'En Teams, ve al canal donde quieres publicar.',
        'Pasa el ratón sobre el nombre del canal y pulsa los **⋯** (Más opciones).',
        'Elige **Flujos de trabajo** (Workflows).'
      ],
      check: 'Se abre una ventana con plantillas de flujos de trabajo.',
      notes: [LABELS_MAY_CHANGE]
    },
    {
      id: 'webhook-plantilla',
      title: 'Elige la plantilla del webhook',
      summary: 'Es una plantilla oficial de Microsoft que publica en el canal lo que le envía YoutubeMeta.',
      actions: [
        'Busca la plantilla **Publicar en un canal cuando se reciba una solicitud de webhook** (en inglés: **Post to a channel when a webhook request is received**).',
        'Púlsala. Si te pide iniciar sesión o permitir la conexión con Teams, acepta.'
      ],
      check: 'Ves una pantalla con el nombre del flujo y el equipo y canal de destino.'
    },
    {
      id: 'webhook-agregar',
      title: 'Confirma el equipo y el canal',
      summary: 'El flujo publicará siempre en el canal que elijas aquí.',
      actions: [
        'Comprueba que **Equipo** y **Canal** son los correctos.',
        'Pulsa **Agregar flujo de trabajo** (Add workflow).'
      ],
      check: 'Aparece un mensaje de que el flujo se agregó, con una dirección (URL) larga.'
    },
    {
      id: 'webhook-url',
      title: 'Copia la URL (trátala como una contraseña)',
      summary: 'Quien tenga esta URL puede escribir en el canal. No la compartas.',
      actions: [
        'Copia la URL que aparece al final. Empieza por `https://` y suele contener `logic.azure.com` o `powerplatform.com`.',
        'Si cerraste la ventana, en Teams abre **Flujos de trabajo** › tu flujo › el primer paso «Cuando se recibe una solicitud de webhook» y copia la URL de allí (puede cambiar).'
      ],
      check: 'Tienes copiada una URL https larga.'
    },
    {
      id: 'webhook-pegar',
      title: 'Pégala en YoutubeMeta',
      summary: 'El canal queda como una cuenta más de Teams.',
      actions: [
        'En YoutubeMeta abre **Conexiones › Teams** y pulsa **Añadir canal por webhook**.',
        'Ponle un **Nombre** (por ejemplo «Soporte») y pega la **URL**.',
        'Pulsa **Añadir canal**. Después haz una publicación de prueba de texto.'
      ],
      check: 'El canal aparece en la tarjeta de Teams con la nota «Canal (webhook)», y la prueba llega firmada por «Workflows».',
      notes: ['Con webhook no se publican videos ni PDF, y las imágenes solo funcionan si YoutubeMeta está publicada en un dominio público.']
    },
    {
      id: 'bandeja',
      title: 'Bandeja: lee las respuestas a tus publicaciones',
      optional: true,
      link: { label: 'Abrir Conexiones', url: '/connections' },
      summary: 'Las respuestas en los hilos de lo que publicas llegan a la Bandeja y se contestan desde allí.',
      actions: [
        'En tu app de Microsoft Entra: **Permisos de API › Agregar un permiso › Microsoft Graph › Delegados** › `ChannelMessage.Read.All`.',
        'Ese permiso necesita **consentimiento de un administrador**: pídelo a TI (sección «Si necesitas a TI» de esta guía).',
        'En **Conexiones › Teams** marca **Leer también las respuestas** y pulsa **Conectar Teams** (o **Reconectar** en cada canal).'
      ],
      check: 'En **Configuración › Bandeja** los canales salen **Consulta periódica** sin avisos, y las respuestas a tus publicaciones aparecen en la Bandeja.',
      notes: ['Los canales conectados **por webhook** no pueden leer: ese camino solo envía.']
    }
  ],
  faqs: [
    {
      id: 'como-yo',
      question: '¿Lo verán como si lo hubiera escrito yo?',
      answer: [
        'Con la forma A (Graph), sí: el mensaje aparece con tu nombre, como si lo escribieras tú.',
        'Con la forma B (webhook), aparece «Workflows en nombre de…» la persona que creó el flujo.'
      ]
    },
    {
      id: 'privado',
      question: '¿Puedo publicar en un canal privado?',
      answer: [
        'Con Graph, sí, si eres miembro del canal privado.',
        'Con el webhook, depende de cómo tenga configurado Teams tu organización.'
      ]
    },
    {
      id: 'contrasena',
      question: '¿Qué pasa si cambio la contraseña?',
      symptom: 'Microsoft pidió volver a iniciar sesión',
      answer: [
        'Microsoft puede pedir que vuelvas a iniciar sesión. Los canales quedan en **Reconectar** y la app te avisa.',
        'Pulsa **Reconectar** en cualquiera de tus canales de Teams; lo que esperaba en cola continúa solo.'
      ]
    },
    {
      id: 'quitar',
      question: '¿Cómo lo quito?',
      answer: [
        'En **Conexiones › Teams** pulsa **Quitar** en cada canal. Lo ya publicado no se borra.',
        'Si no vas a volver a usarlo, en Entra abre **Registros de aplicaciones**, elige YoutubeMeta y pulsa **Eliminar**. Para un webhook, borra también el flujo en Teams (Flujos de trabajo).'
      ]
    },
    {
      id: 'revisar',
      question: '¿Por qué una publicación puede quedar en «Revisar»?',
      answer: [
        'Si la conexión se corta justo mientras se envía, YoutubeMeta no puede leer el canal para comprobar si el mensaje llegó (con webhook nunca puede comprobarlo).',
        'Para no duplicar, la deja en **Revisar**: mira el canal y pulsa **Ya está publicado** o **Publicar de nuevo**.'
      ]
    },
    {
      id: 'aprobacion',
      question: '«Se necesita aprobación del administrador»',
      symptom: 'Se necesita aprobación del administrador',
      answer: [
        'Tu organización no deja que cada persona apruebe apps. Envía a TI el mensaje del **paso 6**: incluye el enlace de aprobación.',
        'Mientras tanto puedes conectar canales con la forma B (webhook).'
      ],
      stepId: 'ti'
    },
    {
      id: 'cuenta-personal',
      question: '«Las cuentas personales de Microsoft no sirven»',
      symptom: 'personal_account',
      answer: [
        'Entraste con una cuenta `@outlook.com`, `@hotmail.com` o `@live.com`. Teams para empresas necesita la cuenta de trabajo o escuela.',
        'Al conectar, si Microsoft recuerda la cuenta personal, pulsa **Usar otra cuenta**.'
      ],
      stepId: 'cuenta'
    },
    {
      id: 'sin-equipos',
      question: '«Tu cuenta no pertenece a ningún equipo de Teams»',
      symptom: 'no_teams',
      answer: ['La cuenta con la que entraste no es miembro de ningún equipo. Pide que te añadan al equipo o entra con otra cuenta de la organización.'],
      stepId: 'conectar'
    },
    {
      id: 'no-puedo-registrar',
      question: 'No me deja crear el registro de la app',
      answer: [
        'Algunas organizaciones solo permiten registrar apps a TI. Pide a TI que haga los pasos 2 a 5 por ti (o que te den el rol «Desarrollador de aplicaciones»), o usa la forma B.'
      ],
      stepId: 'registro'
    },
    {
      id: 'secreto-invalido',
      question: 'Al conectar, Microsoft dice que el secreto no es válido',
      symptom: 'invalid_client',
      answer: [
        'Casi siempre se copió el **Id. del secreto** en lugar del **Valor**, o el secreto caducó.',
        'Crea un secreto nuevo (paso 4), copia el **Valor** y guárdalo en Ajustes.'
      ],
      stepId: 'secreto'
    },
    {
      id: 'moderadores',
      question: '«En este canal solo publican los moderadores»',
      answer: ['El canal está moderado. Pide que te hagan moderador o quita ese canal de YoutubeMeta.']
    },
    {
      id: 'metricas',
      question: '¿Por qué no salen vistas ni «me gusta» de Teams en Resultados?',
      answer: ['Teams no da esas estadísticas a la app. En Resultados verás lo publicado y lo fallido de cada canal, con «—» en las cifras.']
    }
  ]
};
