import { IGuide } from './guide.models';

export const TELEGRAM_GUIDE: IGuide = {
  platform: 'telegram',
  title: 'Conectar canales de Telegram',
  intro:
    'Telegram publica con un **bot**: una cuenta automática que creas en dos minutos con @BotFather. El bot se añade como **administrador** de tu canal y ' +
    'YoutubeMeta publica a través de él. No hay revisiones ni permisos que aprobar, y **un mismo bot sirve para todos tus canales**.',
  duration: '5 minutos',
  requirements: [
    'La app de Telegram (móvil o escritorio) con la cuenta **dueña o administradora** del canal.',
    'Un canal (público o privado) o un grupo donde publicar.',
    'Videos de hasta **50 MB** con el servidor público de Telegram. Para más (hasta 2 GB) mira el paso 6.'
  ],
  steps: [
    {
      id: 'bot',
      title: 'Crea el bot con @BotFather',
      link: { label: 'Abrir @BotFather', url: 'https://t.me/BotFather' },
      summary: '@BotFather es el bot oficial de Telegram para crear bots.',
      actions: [
        'En Telegram busca **@BotFather** (con la marca azul de verificado) y pulsa **Iniciar**.',
        'Envía `/newbot`.',
        'Escribe el **nombre** visible (por ejemplo `YoutubeMeta Publicador`) y después el **usuario**, que debe terminar en `bot` (por ejemplo `tuempresa_publicador_bot`).',
        'BotFather responde con el **token**: un texto como `123456789:AA…`. Cópialo.'
      ],
      shot: {
        url: 't.me/BotFather',
        title: 'BotFather',
        blocks: [
          { kind: 'row', label: '/newbot', sub: 'Tú', mark: 2 },
          { kind: 'row', label: 'Alright, a new bot. How are we going to call it?', sub: 'BotFather' },
          { kind: 'row', label: 'tuempresa_publicador_bot', sub: 'Tú', mark: 3 },
          { kind: 'secret', label: 'Use this token to access the HTTP API: 123456789:AA…', mark: 4 }
        ]
      },
      check: 'Tienes copiado un token con el formato `números:letras`.',
      notes: ['El token es como una contraseña: quien lo tenga controla el bot. Si se filtra, en @BotFather usa `/revoke` y guarda el nuevo en Ajustes.'],
      faqIds: ['token-invalido']
    },
    {
      id: 'guardar',
      title: 'Guarda el bot en YoutubeMeta',
      link: { label: 'Abrir Ajustes', url: '/settings' },
      summary: 'Se guarda cifrado y se comprueba con Telegram al momento.',
      actions: [
        'Abre **⚙️ Ajustes › Plataformas › Bots de Telegram** (o, en **Conexiones › Telegram › + Añadir canal**, despliega **+ Añadir un bot nuevo**).',
        'Pega el token y pulsa **Guardar bot**.',
        'Deja vacío **Servidor Bot API propio** salvo que hayas hecho el paso 6.'
      ],
      shot: {
        url: 'YoutubeMeta › Ajustes › Plataformas',
        sidebar: [{ label: 'Biblioteca' }, { label: 'Publicaciones' }, { label: 'Conexiones' }, { label: 'Ajustes', active: true, mark: 1 }],
        title: '✈ Bots de Telegram',
        blocks: [
          { kind: 'secret', label: 'Token del bot: 123456789:AA…', mark: 2 },
          { kind: 'field', label: 'Servidor Bot API propio', value: '(vacío = api.telegram.org)', mark: 3 },
          { kind: 'note', tone: 'ok', text: 'Bot guardado y comprobado con Telegram: @tuempresa_publicador_bot' }
        ],
        buttons: [{ label: 'Guardar bot', primary: true, mark: 2 }]
      },
      check: 'El bot aparece en la lista como **@tuempresa_publicador_bot** «hasta 50 MB por video».',
      faqIds: ['token-invalido']
    },
    {
      id: 'admin',
      title: 'Añade el bot como administrador del canal',
      summary: 'Sin esto Telegram no deja publicar al bot. Se hace en cada canal.',
      actions: [
        'Abre tu canal › pulsa su **nombre** arriba › **Administradores** (en móvil: **✏️ Editar › Administradores**).',
        'Pulsa **Añadir administrador** y busca el **@usuario** de tu bot.',
        'Deja activado **Publicar mensajes** (los demás permisos no hacen falta) y pulsa **Guardar** / **Listo**.'
      ],
      shot: {
        url: 'Telegram › Tu canal › Administradores',
        title: 'Permisos de administrador · @tuempresa_publicador_bot',
        blocks: [
          { kind: 'check', label: 'Cambiar información del canal', checked: false },
          { kind: 'check', label: 'Publicar mensajes', checked: true, mark: 3 },
          { kind: 'check', label: 'Editar mensajes de otros', checked: false },
          { kind: 'check', label: 'Eliminar mensajes de otros', checked: false }
        ],
        buttons: [{ label: 'Guardar', primary: true, mark: 3 }]
      },
      check: 'En **Administradores** del canal aparece tu bot.',
      notes: ['En un **grupo** (no canal) el bot también debe ser administrador para que Telegram le deje enviar videos sin restricciones.'],
      faqIds: ['sin-permiso', 'no-encuentra']
    },
    {
      id: 'conectar',
      title: 'Conecta el canal en YoutubeMeta',
      summary: 'Aquí, en **Conexiones**.',
      actions: [
        'En la tarjeta de Telegram pulsa **+ Añadir canal** y elige el bot.',
        '**Canal público**: escribe su `@usuario` (o pega el enlace `t.me/…`) y pulsa **Conectar**.',
        '**Canal privado**: pulsa **🔎 Buscar canales donde añadí el bot** y **Conectar** en el tuyo (el bot ve los canales de las últimas 24 h).',
        'Pulsa **Probar**: debe decir «@tu_bot puede publicar en …».'
      ],
      shot: {
        url: 'YoutubeMeta › Conexiones',
        title: 'Conectar canal de Telegram',
        blocks: [
          { kind: 'field', label: 'Bot', value: '@tuempresa_publicador_bot · hasta 50 MB', mark: 1 },
          { kind: 'field', label: 'Canal', value: '@tucanal', mark: 2 },
          { kind: 'row', label: 'Tu canal privado', sub: 'privado · -1001234567890 · channel', button: 'Conectar', mark: 3 }
        ],
        buttons: [{ label: '🔎 Buscar canales donde añadí el bot', mark: 3 }]
      },
      check: 'La tarjeta de Telegram muestra el canal con **Conectada** y el bot que usa.',
      faqIds: ['no-encuentra', 'privado-no-aparece', 'webhook']
    },
    {
      id: 'publicar',
      title: 'Cómo se publica en Telegram',
      summary: 'Desde el detalle de un video: **Publicar en varias cuentas** y marca el canal.',
      actions: [
        'El **texto** del mensaje es la descripción (o el título si está vacía), hasta 1024 caracteres.',
        '**Publicar en silencio**: los suscriptores no reciben sonido de aviso.',
        '**Impedir reenviar y guardar**: activa la protección de contenido de Telegram en ese mensaje.',
        '**Programar**: YoutubeMeta envía el video a la hora indicada.'
      ],
      check: 'En **Publicaciones** la fila pasa a **Publicado** con el enlace al mensaje (`t.me/…`).',
      notes: ['Telegram publica en el acto: no hay «procesando». Si la conexión se corta a mitad, el reintento vuelve a enviar el video completo.'],
      faqIds: ['50mb']
    },
    {
      id: 'servidor-propio',
      title: 'Videos de más de 50 MB: servidor Bot API propio',
      optional: true,
      link: { label: 'Ver telegram-bot-api', url: 'https://github.com/tdlib/telegram-bot-api' },
      summary: 'El servidor público de Telegram acepta 50 MB por archivo; un servidor Bot API propio, gratuito y oficial, acepta hasta **2000 MB**.',
      actions: [
        'Consigue `api_id` y `api_hash` en [my.telegram.org](https://my.telegram.org) › **API development tools**.',
        'En el servidor de YoutubeMeta instala **telegram-bot-api** (oficial de Telegram) y ejecútalo con `--local --api-id=… --api-hash=…`. Escucha en `http://localhost:8081`.',
        'Una sola vez, saca el bot del servidor público: abre en el navegador `https://api.telegram.org/bot<TOKEN>/logOut`.',
        'En **Ajustes › Bots de Telegram › Editar** pon **Servidor Bot API propio** = `http://localhost:8081` y **Máximo por video** = `2000`. Guarda.'
      ],
      check: 'El bot muestra «Servidor propio http://localhost:8081 · hasta 2000 MB por video».',
      notes: ['Mientras el servidor propio esté en marcha, el bot no funciona en api.telegram.org. Para volver: `logOut` en tu servidor y borra la dirección en Ajustes.']
    },
    {
      id: 'cambiar',
      title: 'Más canales, ★ por defecto y quitar',
      optional: true,
      summary: 'El mismo bot sirve para todos: repite los pasos 3 y 4 en cada canal.',
      actions: [
        'Añade el bot como administrador del nuevo canal y conéctalo con **+ Añadir canal**.',
        '**★ Marcar por defecto** y **✎ Nombre corto** funcionan igual que en las demás plataformas.',
        '**Quitar** deja de publicar en ese canal (el bot sigue de administrador: quítalo en Telegram si ya no lo usas).',
        'Un bot con canales conectados no se puede borrar en Ajustes: quita antes sus canales.'
      ],
      check: 'Cada canal aparece en su fila dentro de la tarjeta de Telegram.'
    },
    {
      id: 'bandeja',
      title: 'Bandeja: mensajes al bot y comentarios del canal',
      optional: true,
      link: { label: 'Abrir Configuración › Bandeja', url: '/settings/inbox' },
      summary: 'El mismo bot sirve: no hace falta ningún permiso nuevo.',
      actions: [
        '**Mensajes privados**: llegan cuando alguien escribe a tu bot (un bot no puede escribir primero). Comparte el enlace `t.me/tu_bot`.',
        '**Comentarios**: en tu canal activa **Comentarios** (Administrar canal › Debate) con un grupo de discusión y añade el bot a ese grupo. Para que lea todo el grupo, en @BotFather usa `/setprivacy` › **Disable**.',
        'Sin dirección pública la app pregunta a Telegram cada pocos segundos; con `App:PublicBaseUrl` (https) usa webhook y llega al instante.'
      ],
      check: 'Un mensaje a tu bot aparece en la **Bandeja** y puedes responderlo desde allí.',
      notes: ['Con la bandeja activa, la app lee las novedades del bot: **Buscar canales donde añadí el bot** sigue funcionando porque se guardan.']
    }
  ],
  faqs: [
    {
      id: 'token-invalido',
      question: '«Telegram no reconoce el token del bot»',
      symptom: 'Telegram no reconoce el token del bot. Revísalo en Ajustes (quizá se regeneró en @BotFather).',
      answer: [
        'El token está mal copiado (sobran espacios o falta un trozo) o se regeneró con `/revoke` en @BotFather.',
        'En @BotFather envía `/mybots` › tu bot › **API Token** para verlo, y pégalo en **Ajustes › Bots de Telegram › Editar**.'
      ],
      stepId: 'guardar'
    },
    {
      id: 'sin-permiso',
      question: '«El bot no es administrador del canal con permiso «Publicar mensajes»»',
      symptom: 'no es administrador del canal con permiso «Publicar mensajes»',
      answer: ['Haz el **paso 3**: el bot debe estar en **Administradores** con **Publicar mensajes** activado. Después pulsa **Conectar** (o **Probar**) otra vez.'],
      stepId: 'admin'
    },
    {
      id: 'no-encuentra',
      question: '«Telegram no encuentra el canal»',
      symptom: 'Telegram no encuentra el canal. Revisa el @usuario o añade el bot al canal.',
      answer: [
        'Revisa el `@usuario` del canal (en la info del canal, sin espacios). Un canal **privado** no tiene @usuario: usa **Buscar canales donde añadí el bot**.',
        'Si el bot aún no es administrador, Telegram responde igual: haz primero el **paso 3**.'
      ],
      stepId: 'conectar'
    },
    {
      id: 'privado-no-aparece',
      question: 'Mi canal privado no aparece al buscar',
      answer: [
        'El bot solo «ve» los canales donde lo añadieron o hubo actividad en las **últimas 24 h**. Quita y vuelve a añadir el bot como administrador (o publica cualquier mensaje en el canal) y busca de nuevo.',
        'También puedes escribir el **id** del canal: abre el canal en [web.telegram.org](https://web.telegram.org); en la barra de direcciones verás `#-100…`: ese número (con el `-100`) es el id.'
      ],
      stepId: 'conectar'
    },
    {
      id: 'webhook',
      question: '«El bot tiene un webhook activo»',
      answer: [
        'El bot está conectado a otro sistema por webhook y Telegram no deja leer sus novedades. Escribe el `@usuario` o el id del canal a mano: publicar funciona igual.',
        'Lo más limpio es crear un bot nuevo solo para YoutubeMeta.'
      ],
      stepId: 'conectar'
    },
    {
      id: '50mb',
      question: '«El bot admite videos de hasta 50 MB»',
      symptom: 'El bot admite videos de hasta 50 MB. Para más (hasta 2 GB) configura un servidor Bot API propio en Ajustes.',
      answer: [
        'Es el límite del servidor público de Telegram para bots. Dos salidas:',
        '1) Comprime el video (por ejemplo a 720p) y súbelo de nuevo a la biblioteca. 2) Configura un **servidor Bot API propio** (**paso 6**), que admite hasta 2 GB.'
      ],
      stepId: 'servidor-propio'
    },
    {
      id: 'espera',
      question: '«Telegram pidió esperar N s antes de enviar más»',
      answer: ['Telegram limita la velocidad de envío. La publicación queda **Esperando cuota** y sale sola al pasar ese tiempo.']
    },
    {
      id: 'duplicado',
      question: 'Se publicó dos veces el mismo video',
      answer: [
        'Puede pasar si la conexión se cortó justo después de que Telegram recibiera el video y antes de responder: YoutubeMeta no recibió la confirmación y reintentó.',
        'Borra el mensaje duplicado en el canal. Es poco frecuente y solo ocurre con cortes de red.'
      ]
    }
  ]
};
