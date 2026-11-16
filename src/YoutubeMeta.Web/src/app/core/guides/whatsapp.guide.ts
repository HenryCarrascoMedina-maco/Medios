import { BUSINESS, businessMenu } from './facebook.guide';
import { IGuide } from './guide.models';

/**
 * WhatsApp Business (solo bandeja) y, de paso, la app de Meta y su webhook: los mismos pasos 5 a 7 hacen que lleguen
 * también los mensajes y comentarios de Facebook e Instagram.
 */
export const WHATSAPP_GUIDE: IGuide = {
  platform: 'whatsapp',
  title: 'Conectar WhatsApp Business a la bandeja',
  intro:
    'WhatsApp no permite **publicar** (ni en Estados ni en Canales), pero sí **chatear** con tus clientes con la API oficial (**WhatsApp Business Cloud API**). ' +
    'Los mensajes llegan a la **Bandeja** junto con los de Facebook, Instagram, Telegram, YouTube y Teams. Usa la misma **app de Meta** y el mismo **usuario del sistema** ' +
    'de la guía de Facebook. Los pasos 5 a 7 (la app de Meta y su webhook) también hacen que lleguen los mensajes y comentarios de Facebook e Instagram.',
  duration: '20 minutos (más lo que tarde Meta en verificar el número)',
  requirements: [
    'Un **portfolio empresarial** de Meta con la **app** y el **usuario del sistema** de la guía de Facebook (pasos 1 a 6).',
    'Un **número de teléfono** para WhatsApp Business. Si ya lo usas en la app WhatsApp Business, Meta permite seguir usándolo allí («coexistencia»).',
    'Que este servidor tenga una **dirección pública con https** (`App:PublicBaseUrl`): Meta avisa de cada mensaje a esa dirección. En desarrollo, un túnel (Dev Tunnels o cloudflared).',
    'Saber que **fuera de las 24 h** desde el último mensaje del cliente solo se pueden enviar **plantillas aprobadas**, y que Meta las **cobra** por mensaje según el país.'
  ],
  steps: [
    {
      id: 'producto',
      title: 'Añade WhatsApp a tu app de Meta',
      link: { label: 'Abrir Mis apps', url: 'https://developers.facebook.com/apps/' },
      summary: 'La misma app que usas para Facebook e Instagram.',
      actions: [
        'En **developers.facebook.com › Mis apps** abre tu app.',
        '**Casos de uso › Añadir caso de uso** › elige **«Conectar con clientes a través de WhatsApp»**.',
        'Sigue el asistente: elige tu **portfolio empresarial** y crea (o elige) una **cuenta de WhatsApp Business**.'
      ],
      shot: {
        url: 'developers.facebook.com/apps/…/use_cases',
        sidebar: [{ label: 'Panel' }, { label: 'Casos de uso', active: true, mark: 2 }, { label: 'Configuración de la app' }],
        title: 'Añadir caso de uso',
        blocks: [
          { kind: 'option', label: 'Conectar con clientes a través de WhatsApp', sub: 'WhatsApp Business Cloud API', checked: true, mark: 2 },
          { kind: 'option', label: 'Administrar todo en tu página', sub: 'Ya añadido (Facebook)', checked: false }
        ],
        buttons: [{ label: 'Siguiente', primary: true, mark: 3 }]
      },
      check: 'En el menú de la app aparece **WhatsApp › Configuración de la API**.'
    },
    {
      id: 'numero',
      title: 'Registra el número de WhatsApp Business',
      link: { label: 'Abrir Administrador de WhatsApp', url: 'https://business.facebook.com/wa/manage/phone-numbers/' },
      summary: 'Meta envía un código por SMS o llamada para comprobar que el número es tuyo.',
      actions: [
        'En **WhatsApp › Configuración de la API** pulsa **Añadir número de teléfono**.',
        'Escribe el **nombre visible** (el que verán tus clientes) y el número, y verifícalo con el código.',
        'Espera a que el nombre visible quede **aprobado** (suele tardar minutos u horas).'
      ],
      shot: {
        url: 'business.facebook.com/wa/manage/phone-numbers',
        title: 'Números de teléfono',
        buttons: [{ label: '+ Añadir número de teléfono', primary: true, mark: 1 }],
        blocks: [{ kind: 'row', label: '+51 999 999 999 · Ventas', sub: 'Conectado · Calidad: alta', mark: 3, selected: true }]
      },
      check: 'El número aparece **Conectado** en el Administrador de WhatsApp.',
      notes: ['El número de prueba que da Meta sirve para ensayar, pero solo envía a 5 números que tú registres.'],
      faqIds: ['coexistencia']
    },
    {
      id: 'activos',
      title: 'Asigna la cuenta de WhatsApp al usuario del sistema',
      link: { label: 'Abrir Usuarios del sistema', url: 'https://business.facebook.com/latest/settings/system_users' },
      summary: 'El mismo usuario del sistema de Facebook (`youtubemeta-publicador`).',
      actions: [
        '**Ajustes › Usuarios del sistema** › `youtubemeta-publicador` › **Asignar activos**.',
        'Tipo **Cuentas de WhatsApp** › marca tu cuenta › activa **Control total**.',
        'Pulsa **Asignar activos**.'
      ],
      shot: {
        url: `${BUSINESS}/system_users`,
        sidebar: businessMenu('Usuarios del sistema', 1),
        title: 'Asignar activos · youtubemeta-publicador',
        blocks: [
          { kind: 'heading', text: 'Cuentas de WhatsApp' },
          { kind: 'check', label: 'Tu empresa (WhatsApp Business)', checked: true, mark: 2 },
          { kind: 'check', label: 'Control total', checked: true, mark: 2 }
        ],
        buttons: [{ label: 'Asignar activos', primary: true, mark: 3 }]
      },
      check: 'En la pestaña **Activos** del usuario del sistema aparece la cuenta de WhatsApp.'
    },
    {
      id: 'token',
      title: 'Genera el token con los permisos de WhatsApp',
      link: { label: 'Abrir Usuarios del sistema', url: 'https://business.facebook.com/latest/settings/system_users' },
      summary: 'Un token que ya tenías no gana permisos nuevos: genera otro.',
      actions: [
        'En `youtubemeta-publicador` pulsa **Generar token**, elige tu **app** y caducidad **Nunca**.',
        'Marca `whatsapp_business_messaging` y `whatsapp_business_management`.',
        'Pulsa **Generar token** y cópialo.'
      ],
      shot: {
        url: `${BUSINESS}/system_users`,
        sidebar: businessMenu('Usuarios del sistema', 1),
        title: 'Generar token',
        blocks: [
          { kind: 'check', label: 'whatsapp_business_messaging', checked: true, mark: 2 },
          { kind: 'check', label: 'whatsapp_business_management', checked: true, mark: 2 },
          { kind: 'secret', label: 'EAAG… (cópialo ahora: no se vuelve a mostrar)', mark: 3 }
        ]
      },
      check: 'Tienes copiado un token que empieza por `EAA`.',
      faqIds: ['sin-cuentas']
    },
    {
      id: 'app-meta',
      title: 'Guarda la app de Meta en Ajustes',
      link: { label: 'Abrir Ajustes', url: '/settings' },
      summary: 'Con el App Secret la app comprueba que cada aviso viene de verdad de Meta. Sirve para Facebook, Instagram y WhatsApp.',
      actions: [
        'En tu app de Meta: **Configuración de la app › Básica**. Copia el **Identificador de la app** y, con **Mostrar**, la **Clave secreta de la app**.',
        'En YoutubeMeta: **Ajustes › Plataformas › App de Meta (bandeja)**. Pega los dos y pulsa **Guardar**.',
        'Al guardar aparecen la **URL del webhook** y el **texto de verificación** que usarás en el paso siguiente.'
      ],
      shot: {
        url: 'YoutubeMeta › Ajustes › Plataformas',
        sidebar: [{ label: 'Inicio' }, { label: 'Bandeja' }, { label: 'Conexiones' }, { label: 'Ajustes', active: true, mark: 2 }],
        title: 'App de Meta (bandeja)',
        blocks: [
          { kind: 'field', label: 'App ID', value: '123456789012345', mark: 1 },
          { kind: 'secret', label: 'App Secret: ••••••••', mark: 1 },
          { kind: 'note', tone: 'ok', text: 'Guardada. URL del webhook y texto de verificación listos para copiar.' }
        ],
        buttons: [{ label: 'Guardar', primary: true, mark: 2 }]
      },
      check: 'En Ajustes la app de Meta sale **Guardada aquí** con la URL del webhook.',
      notes: ['La clave secreta es como una contraseña: si se filtra, en Meta pulsa **Restablecer** y guarda la nueva aquí.']
    },
    {
      id: 'webhook',
      title: 'Configura el webhook en Meta',
      link: { label: 'Abrir Mis apps', url: 'https://developers.facebook.com/apps/' },
      summary: 'Meta enviará cada mensaje a esta dirección al momento.',
      actions: [
        'En tu app: **WhatsApp › Configuración** (o **Webhooks** en el menú). En **Webhook** pulsa **Editar**.',
        'Pega la **URL de devolución de llamada**: {{metaWebhookUrl}}',
        'Pega el **Token de verificación**: {{metaVerifyToken}} y pulsa **Verificar y guardar**.',
        'En **Campos del webhook** suscríbete a `messages`. Para Facebook e Instagram, en **Webhooks** elige **Page** (`messages`, `feed`) e **Instagram** (`messages`, `comments`) con la misma URL.'
      ],
      shot: {
        url: 'developers.facebook.com/apps/…/whatsapp-business/wa-settings',
        sidebar: [{ label: 'WhatsApp', group: true }, { label: 'Configuración de la API' }, { label: 'Configuración', active: true, mark: 1 }],
        title: 'Webhook',
        blocks: [
          { kind: 'field', label: 'URL de devolución de llamada', value: 'https://tu-dominio/api/Webhook/Meta', mark: 2 },
          { kind: 'field', label: 'Token de verificación', value: '••••••••', mark: 3 },
          { kind: 'row', label: 'messages', sub: 'Suscrito', button: 'Suscribirse', mark: 4, selected: true }
        ],
        buttons: [{ label: 'Verificar y guardar', primary: true, mark: 3 }]
      },
      check: 'Meta muestra el webhook **verificado** y `messages` como **Suscrito**.',
      copy: 'metaWebhookUrl',
      faqIds: ['no-verifica', 'no-llegan']
    },
    {
      id: 'conectar',
      title: 'Conecta el número en YoutubeMeta',
      link: { label: 'Abrir Conexiones', url: '/connections' },
      summary: 'La app busca los números a los que da acceso el token y suscribe tu cuenta de WhatsApp Business a los avisos.',
      actions: [
        '**Conexiones › WhatsApp › + Añadir número**.',
        'Pega el token del paso 4 y pulsa **Buscar números**.',
        'Marca los números y pulsa **Conectar**.'
      ],
      shot: {
        url: 'YoutubeMeta › Conexiones',
        sidebar: [{ label: 'Inicio' }, { label: 'Bandeja' }, { label: 'Conexiones', active: true, mark: 1 }],
        title: 'Conectar números de WhatsApp',
        blocks: [
          { kind: 'secret', label: 'Token del usuario del sistema: EAAG…', mark: 2 },
          { kind: 'check', label: 'Ventas · +51 999 999 999', checked: true, mark: 3 }
        ],
        buttons: [{ label: 'Conectar 1', primary: true, mark: 3 }]
      },
      check: 'El número aparece en **Conexiones** y en **Configuración › Bandeja** como **Al instante (webhook)**.'
    },
    {
      id: 'probar',
      title: 'Prueba la bandeja',
      link: { label: 'Abrir la Bandeja', url: '/inbox' },
      summary: 'Escríbete desde otro teléfono.',
      actions: [
        'Desde otro WhatsApp envía un mensaje a tu número.',
        'En segundos aparece en **Bandeja** con un aviso. Respóndelo desde ahí.',
        'Pasadas 24 h sin que el cliente escriba, el compositor te ofrece las **plantillas aprobadas** (créalas en el **Administrador de WhatsApp › Plantillas de mensajes**).'
      ],
      check: 'El mensaje llega a la bandeja y tu respuesta sale con ✓✓ (entregado) o ✓✓ azul (leído).'
    }
  ],
  faqs: [
    {
      id: 'no-verifica',
      question: 'Meta no verifica la URL del webhook',
      symptom: 'The callback URL or verify token couldn\'t be validated',
      answer: [
        'La URL debe ser **https** y accesible desde internet: abre {{metaWebhookUrl}} en el móvil con los datos (no el wifi de la oficina). Debe responder (aunque sea con un error 403).',
        'El **Token de verificación** debe ser exactamente el de **Ajustes › Plataformas › App de Meta**. Si cambiaste la app, guárdala otra vez antes de verificar.',
        'En desarrollo: el túnel debe apuntar al puerto de la API (5080) y `App:PublicBaseUrl` tener esa misma dirección.'
      ],
      stepId: 'webhook'
    },
    {
      id: 'no-llegan',
      question: 'Escribo al número y no llega nada a la bandeja',
      answer: [
        'Mira **Configuración › Bandeja**: la fila del número dice qué falta (dirección pública, app de Meta, permiso del token).',
        'En Meta, **Webhooks**, comprueba que `messages` está **Suscrito**. Pulsa **Preparar de nuevo** en Configuración › Bandeja para volver a suscribir tu cuenta de WhatsApp Business.',
        'Si el App Secret no coincide, la app rechaza los avisos (lo verás en el registro como «firma no válida»). Vuelve a guardarlo en Ajustes.'
      ],
      stepId: 'conectar'
    },
    {
      id: 'sin-cuentas',
      question: '«El token no da acceso a ninguna cuenta de WhatsApp Business»',
      symptom: 'El token no da acceso a ninguna cuenta de WhatsApp Business',
      answer: ['Haz el **paso 3** (asignar la cuenta al usuario del sistema) y genera el token **después** (paso 4) marcando los dos permisos de WhatsApp.'],
      stepId: 'activos'
    },
    {
      id: 'plantilla',
      question: '«Pasaron más de 24 h… solo permite enviar una plantilla aprobada»',
      symptom: 'WhatsApp solo deja enviar una plantilla aprobada',
      answer: [
        'Es una regla de WhatsApp: el texto libre solo vale hasta 24 h después del último mensaje del cliente.',
        'En el compositor elige **Plantilla**: salen las aprobadas de tu cuenta. Para crear una: **Administrador de WhatsApp › Plantillas de mensajes › Crear**. Meta la revisa (minutos u horas).',
        'Las plantillas se cobran por mensaje según el país y la categoría (marketing, utilidad…).'
      ]
    },
    {
      id: 'coexistencia',
      question: '¿Puedo seguir usando el número en la app WhatsApp Business del móvil?',
      answer: [
        'Sí, si al registrarlo eliges la opción de **conectar un número de la app WhatsApp Business** («coexistencia»). Lo que respondas desde el móvil no pasa por la bandeja.',
        'Si registras un número que estaba en la app de WhatsApp normal sin esa opción, deja de funcionar allí.'
      ],
      stepId: 'numero'
    }
  ]
};
