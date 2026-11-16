import { IGuide, IShotNavItem } from './guide.models';

/** Menú de Google Auth Platform (Google Cloud Console). */
function authMenu(active: string, mark?: number): IShotNavItem[] {
  const items = ['Descripción general', 'Desarrollo de la marca', 'Público', 'Clientes', 'Acceso a los datos', 'Verificación'];
  return items.map(label => (label === active ? { label, active: true, mark } : { label }));
}

export const YOUTUBE_GUIDE: IGuide = {
  platform: 'youtube',
  title: 'Conectar canales de YouTube',
  intro:
    'YouTube se conecta con el inicio de sesión de Google (OAuth). Primero, **una sola vez**, se crea en Google Cloud la «app» que pide permiso para subir videos ' +
    '(pasos 1 a 6). Después, añadir **cada canal** es pulsar un botón y elegir la cuenta (paso 7): puedes conectar todos los canales que administres.',
  duration: '20 minutos la primera vez; 1 minuto por cada canal',
  requirements: [
    'Una cuenta de Google con acceso a **Google Cloud Console** (gratis, no pide tarjeta para esta API).',
    'Ser **propietario o administrador** de cada canal (si es un canal de marca, en su *Brand Account*).',
    'Ser administrador de YoutubeMeta para guardar el ID y el secreto en **Ajustes › Plataformas** (paso 6).'
  ],
  steps: [
    {
      id: 'proyecto',
      title: 'Crea un proyecto en Google Cloud',
      link: { label: 'Abrir «Nuevo proyecto»', url: 'https://console.cloud.google.com/projectcreate' },
      summary: 'El proyecto agrupa la API, la pantalla de permisos y la cuota diaria.',
      actions: [
        'Entra en **console.cloud.google.com** con la cuenta de Google de la empresa.',
        'Pulsa **Nuevo proyecto**; nombre: `YoutubeMeta`.',
        'Pulsa **Crear** y, cuando termine, asegúrate de que está **seleccionado** arriba a la izquierda.'
      ],
      shot: {
        url: 'console.cloud.google.com/projectcreate',
        title: 'Nuevo proyecto',
        blocks: [
          { kind: 'field', label: 'Nombre del proyecto', value: 'YoutubeMeta', mark: 2 },
          { kind: 'field', label: 'Ubicación', value: 'Sin organización' }
        ],
        buttons: [{ label: 'Crear', primary: true, mark: 3 }]
      },
      check: 'Arriba, en el selector de proyecto, se ve **YoutubeMeta**.',
      notes: ['Importante: los videos subidos desde un proyecto **no auditado** por YouTube quedan **privados**. Ver el paso 8.']
    },
    {
      id: 'api',
      title: 'Habilita YouTube Data API v3',
      link: { label: 'Abrir la API en la biblioteca', url: 'https://console.cloud.google.com/apis/library/youtube.googleapis.com' },
      summary: 'Sin esto Google rechaza cualquier llamada con «API not enabled».',
      actions: [
        'Menú **APIs y servicios › Biblioteca**.',
        'Busca `YouTube Data API v3` y ábrela.',
        'Pulsa **Habilitar**.'
      ],
      shot: {
        url: 'console.cloud.google.com/apis/library/youtube.googleapis.com',
        sidebar: [{ label: 'APIs y servicios', group: true }, { label: 'Biblioteca', active: true, mark: 1 }, { label: 'Credenciales' }],
        title: 'YouTube Data API v3',
        blocks: [{ kind: 'row', label: 'YouTube Data API v3', sub: 'Google Enterprise API', mark: 2 }],
        buttons: [{ label: 'Habilitar', primary: true, mark: 3 }]
      },
      check: 'La página de la API muestra **Administrar** y «API habilitada».'
    },
    {
      id: 'marca',
      title: 'Configura la pantalla de permisos (Google Auth Platform)',
      link: { label: 'Abrir Google Auth Platform', url: 'https://console.cloud.google.com/auth/overview' },
      summary: 'Es la pantalla que verá quien conecte el canal: «YoutubeMeta quiere acceder a tu cuenta de Google».',
      actions: [
        'Pulsa **Comenzar** (si ya estaba configurada, ve directo a la acción 4).',
        '**Información de la app**: nombre `YoutubeMeta` y tu correo como correo de asistencia.',
        '**Público**: elige **Externo**. **Información de contacto**: tu correo. Acepta la política y pulsa **Crear**.',
        'Menú **Acceso a los datos › Agregar o quitar permisos**: filtra por `youtube` y marca `.../auth/youtube.upload` y `.../auth/youtube.readonly`. **Actualizar** y **Guardar**.'
      ],
      shot: {
        url: 'console.cloud.google.com/auth/scopes',
        sidebar: authMenu('Acceso a los datos', 4),
        title: 'Agregar o quitar permisos',
        blocks: [
          { kind: 'check', label: '…/auth/youtube.upload · Administrar tus videos de YouTube', checked: true, mark: 4 },
          { kind: 'check', label: '…/auth/youtube.readonly · Ver tu cuenta de YouTube', checked: true, mark: 4 },
          { kind: 'check', label: '…/auth/youtube · Administrar tu cuenta de YouTube', checked: false }
        ],
        buttons: [{ label: 'Actualizar', primary: true, mark: 4 }]
      },
      check: 'En **Acceso a los datos** aparecen los dos permisos de YouTube en «Tus permisos sensibles».',
      notes: ['Elige **Externo** aunque solo lo uses tú: «Interno» solo existe con Google Workspace y no sirve para cuentas @gmail.com ni Brand Accounts.']
    },
    {
      id: 'publico',
      title: 'Pasa la app a producción (o añade usuarios de prueba)',
      link: { label: 'Abrir Público', url: 'https://console.cloud.google.com/auth/audience' },
      summary: 'En modo **Prueba** solo pueden conectar los usuarios de prueba y el acceso **caduca a los 7 días**. Para uso continuo, pásala a producción.',
      actions: [
        'Menú **Público**.',
        'Recomendado: pulsa **Publicar app** › **Confirmar**. El estado pasa a **En producción**.',
        'Alternativa temporal: en **Usuarios de prueba › Add users** añade el correo que conectará el canal.'
      ],
      shot: {
        url: 'console.cloud.google.com/auth/audience',
        sidebar: authMenu('Público', 1),
        title: 'Público',
        blocks: [
          { kind: 'field', label: 'Estado de publicación', value: 'Prueba' },
          { kind: 'note', tone: 'warn', text: 'En modo Prueba los tokens caducan a los 7 días.' },
          { kind: 'row', label: 'Usuarios de prueba', sub: 'canal@empresa.com', button: '+ Add users', mark: 3 }
        ],
        buttons: [{ label: 'Publicar app', primary: true, mark: 2 }]
      },
      check: 'Estado de publicación: **En producción** (o tu correo en Usuarios de prueba).',
      notes: [
        'En producción sin verificar, Google mostrará «Google no ha verificado esta app» al conectar. Es normal para uso interno: se continúa en **Configuración avanzada** (ver paso 7).'
      ],
      faqIds: ['publicar-gris', 'siete-dias', 'access-denied']
    },
    {
      id: 'cliente',
      title: 'Crea el cliente OAuth (ID y secreto)',
      link: { label: 'Abrir Clientes', url: 'https://console.cloud.google.com/auth/clients' },
      summary: 'Genera los dos valores que el servidor usa para hablar con Google.',
      actions: [
        'Menú **Clientes › Crear cliente**.',
        'Tipo de aplicación: **Aplicación web**. Nombre: `YoutubeMeta servidor`.',
        'En **URIs de redireccionamiento autorizados** pulsa **Agregar URI** y pega exactamente: `{{redirectUri}}`',
        'Pulsa **Crear** y copia el **ID de cliente** y el **Secreto del cliente** (pulsa **Descargar JSON**: el secreto solo se muestra completo ahora).'
      ],
      shot: {
        url: 'console.cloud.google.com/auth/clients/create',
        sidebar: authMenu('Clientes', 1),
        title: 'Crear ID de cliente de OAuth',
        blocks: [
          { kind: 'field', label: 'Tipo de aplicación', value: 'Aplicación web', mark: 2 },
          { kind: 'field', label: 'Nombre', value: 'YoutubeMeta servidor', mark: 2 },
          { kind: 'heading', text: 'URIs de redireccionamiento autorizados' },
          { kind: 'field', label: 'URI 1', value: '{{redirectUri}}', mark: 3 },
          { kind: 'secret', label: 'ID de cliente: 1234…apps.googleusercontent.com', mark: 4 }
        ],
        buttons: [{ label: 'Crear', primary: true, mark: 4 }]
      },
      check: 'Tienes el **ID de cliente** (termina en `.apps.googleusercontent.com`) y el **secreto** (empieza por `GOCSPX-`).',
      copy: 'redirectUri',
      notes: [
        'La URI debe coincidir **carácter por carácter** (http/https, puerto, mayúsculas). Si publicas en IIS con otro dominio, añade también esa URI.',
        '**Orígenes de JavaScript autorizados** no hace falta: el inicio de sesión lo hace el servidor.'
      ],
      faqIds: ['redirect-mismatch']
    },
    {
      id: 'servidor',
      title: 'Guarda el ID y el secreto en YoutubeMeta',
      link: { label: 'Abrir Ajustes', url: '/settings' },
      summary: 'Desde la propia app, sin tocar el servidor. Se guardan **cifrados** y el secreto no se vuelve a mostrar.',
      actions: [
        'En YoutubeMeta abre **⚙️ Ajustes › Plataformas** (menú de la izquierda).',
        'En **Google · YouTube** pega el **ID de cliente** y el **Secreto** del paso 5.',
        'Pulsa **Guardar**. La etiqueta pasa a **Guardada aquí**.'
      ],
      shot: {
        url: 'youtubemeta › Ajustes › Plataformas',
        sidebar: [{ label: 'Biblioteca' }, { label: 'Publicaciones' }, { label: 'Conexiones' }, { label: 'Ajustes', active: true, mark: 1 }],
        title: '▶ Google · YouTube',
        blocks: [
          { kind: 'field', label: 'ID de cliente', value: '1234…apps.googleusercontent.com', mark: 2 },
          { kind: 'secret', label: 'Secreto: GOCSPX-••••••••', mark: 2 },
          { kind: 'field', label: 'URI de redirección', value: '{{redirectUri}}' }
        ],
        buttons: [{ label: 'Guardar', primary: true, mark: 3 }]
      },
      check: 'En **Conexiones** desaparece el aviso «Falta el cliente OAuth de Google» y el botón **+ Añadir canal** se activa.',
      notes: [
        'Alternativa para administradores del servidor: `dotnet user-secrets set "Google:ClientId" "<ID>"` (desarrollo) o las variables `Google__ClientId` y `Google__ClientSecret` del app pool de IIS. Lo guardado en Ajustes tiene prioridad.',
        'La **URI de redirección** depende del servidor y no se cambia en Ajustes: es `Google:RedirectUri` en la configuración (`Google__RedirectUri` en IIS).'
      ],
      faqIds: ['no-configurado']
    },
    {
      id: 'conectar',
      title: 'Conecta el canal',
      summary: 'Desde aquí, en **Conexiones**. Repite este paso por cada canal que quieras administrar.',
      actions: [
        'En la tarjeta de YouTube pulsa **+ Añadir canal**.',
        'Elige la cuenta de Google. Si el canal es de marca, Google te pedirá elegir el **canal** (Brand Account): elige el correcto.',
        'Si aparece «Google no ha verificado esta app», pulsa **Configuración avanzada › Ir a YoutubeMeta (no seguro)**.',
        'Deja marcados los permisos, en especial **«Administrar tus videos de YouTube»**, y pulsa **Continuar**.',
        'Vuelves a Conexiones con el canal añadido. Pulsa **Probar**.'
      ],
      shot: {
        url: 'accounts.google.com/signin/oauth',
        title: 'YoutubeMeta quiere acceder a tu cuenta de Google',
        blocks: [
          { kind: 'row', label: 'Mi canal (Brand Account)', sub: 'canal@empresa.com', mark: 2, selected: true },
          { kind: 'note', tone: 'warn', text: 'Google no ha verificado esta app → Configuración avanzada → Ir a YoutubeMeta' },
          { kind: 'check', label: 'Administrar tus videos de YouTube', checked: true, mark: 4 },
          { kind: 'check', label: 'Ver tu cuenta de YouTube', checked: true, mark: 4 }
        ],
        buttons: [{ label: 'Continuar', primary: true, mark: 4 }]
      },
      check: 'La tarjeta de YouTube muestra el canal con la etiqueta **Conectada**. El primero queda marcado con **★** (viene elegido al publicar).',
      faqIds: ['no-verificada', 'brand-account', 'sin-canal', 'access-denied', 'varios-canales']
    },
    {
      id: 'auditoria',
      title: 'Solicita la auditoría para publicar videos públicos',
      link: { label: 'Abrir formulario de auditoría', url: 'https://support.google.com/youtube/contact/yt_api_form' },
      summary:
        'Regla de YouTube: los videos subidos por API desde un proyecto **no auditado** quedan **bloqueados como privados**, aunque elijas «Público». Mientras tanto puedes subir como Privado u Oculto y probar todo.',
      actions: [
        'Abre el **formulario de auditoría y ampliación de cuota** de YouTube API Services.',
        'Indica el número de proyecto de Google Cloud (lo ves en **Panel** del proyecto) y describe el uso: «Publicación de videos propios de la empresa en nuestro canal desde una herramienta interna».',
        'Adjunta capturas de YoutubeMeta si lo piden (biblioteca y diálogo de publicación).'
      ],
      check: 'Google responde por correo. Tras aprobarse, los videos nuevos respetan la privacidad elegida.',
      notes: ['Los videos que ya quedaron bloqueados como privados no se pueden desbloquear: se vuelven a subir después de la auditoría.'],
      faqIds: ['videos-privados', 'cuota'],
      optional: true
    },
    {
      id: 'cambiar',
      title: 'Más canales, ★ por defecto y quitar',
      optional: true,
      summary: 'Los pasos 1 a 6 no se repiten: todos los canales usan el mismo cliente de Google.',
      actions: [
        '**Añadir otro canal**: **+ Añadir canal** y elige en Google la otra cuenta o el otro canal de marca.',
        '**★ Marcar por defecto**: ese canal viene marcado al publicar (puedes marcar otros en el momento).',
        '**✎ Nombre corto**: un alias para distinguir canales con nombres parecidos.',
        '**Reconectar**: si sale «Reconectar», vuelve a entrar con el **mismo** canal; lo que esperaba continúa solo.',
        '**Quitar**: borra el token, revoca el permiso en Google y cancela solo lo pendiente de ese canal.'
      ],
      check: 'Cada canal aparece en su propia fila dentro de la tarjeta de YouTube; al publicar puedes marcar varios a la vez.',
      notes: [
        'La **cuota diaria es del proyecto de Google**, no del canal: las 100 subidas y 10 000 unidades se reparten entre todos los canales. La tarjeta muestra cuánto gastó cada uno.',
        'También puedes revocar el permiso desde Google: [myaccount.google.com/permissions](https://myaccount.google.com/permissions).'
      ],
      faqIds: ['varios-canales', 'cuota']
    },
    {
      id: 'bandeja',
      title: 'Bandeja: lee y responde los comentarios',
      optional: true,
      link: { label: 'Abrir Conexiones', url: '/connections' },
      summary: 'YouTube no tiene mensajes privados, pero sí comentarios. La app los consulta cada 10 minutos.',
      actions: [
        'Si conectaste el canal antes de existir la Bandeja, pulsa **Reconectar** en **Conexiones › YouTube**: Google pedirá el permiso para **ver, editar y borrar** tus comentarios (`youtube.force-ssl`).',
        'En la pantalla de consentimiento de Google Cloud añade también el scope `youtube.force-ssl` (si tu app está en producción, Google puede pedir revisarla).',
        'En **Configuración › Bandeja** comprueba que el canal sale **Consulta periódica** y sin avisos.'
      ],
      check: 'Los comentarios nuevos de tus videos aparecen en la **Bandeja** en unos minutos.',
      notes: ['Leer cuesta **1 unidad** por consulta y responder **50**, del mismo cupo diario de 10 000 que usan las subidas.']
    }
  ],
  faqs: [
    {
      id: 'varios-canales',
      question: '¿Puedo conectar varios canales? ¿Cómo elijo en cuál se publica?',
      answer: [
        'Sí: pulsa **+ Añadir canal** una vez por canal (en Google eliges cada cuenta o canal de marca). No hay límite en YoutubeMeta.',
        'Al publicar, el diálogo muestra todos los canales: marca uno o varios. El canal con **★** viene marcado por defecto.',
        'Si el canal pertenece a la misma cuenta de Google que otro, en Google elige el **canal de marca** correcto en la pantalla «Elige una cuenta o un canal».',
        'Todos comparten la cuota diaria del proyecto de Google (100 subidas al día en total).'
      ],
      stepId: 'cambiar'
    },
    {
      id: 'videos-privados',
      question: 'Elegí «Público» pero el video quedó privado (o «bloqueado como privado»)',
      answer: [
        'Es la regla de YouTube para proyectos de Google Cloud **sin auditar**: todo lo subido por API queda privado.',
        'Solicita la auditoría (**paso 8**). Mientras tanto, publica como Privado u Oculto, o cambia la visibilidad a mano en YouTube Studio si YouTube lo permite.',
        'Los videos bloqueados antes de la auditoría no se pueden apelar: hay que volver a subirlos.'
      ],
      stepId: 'auditoria'
    },
    {
      id: 'no-configurado',
      question: '«Falta el cliente OAuth de Google» o el botón Añadir canal está gris',
      symptom: 'Falta configurar el cliente de Google (Ajustes › Plataformas). Revisa los pasos 1 a 6 de la guía.',
      answer: [
        'YoutubeMeta no tiene el ID o el secreto del cliente OAuth. Guárdalos en **Ajustes › Plataformas** (**paso 6**): no hace falta reiniciar nada.',
        'Si usas user-secrets o IIS en lugar de Ajustes, reinicia la API después de cambiarlos.',
        'En IIS revisa que las variables usan **doble guion bajo**: `Google__ClientId`, no `Google:ClientId`.'
      ],
      stepId: 'servidor'
    },
    {
      id: 'redirect-mismatch',
      question: 'Error 400: redirect_uri_mismatch',
      symptom: 'Error 400: redirect_uri_mismatch',
      answer: [
        'La URI registrada en el cliente OAuth no es idéntica a la que usa el servidor. Debe ser exactamente: `{{redirectUri}}`',
        'Revisa http frente a https, el puerto y que no sobre una barra al final. Los cambios en Google pueden tardar unos minutos.'
      ],
      stepId: 'cliente'
    },
    {
      id: 'access-denied',
      question: 'Error 403: access_denied («no completó el proceso de verificación»)',
      symptom: 'Error 403: access_denied',
      answer: [
        'La app está en modo **Prueba** y tu correo no está en **Usuarios de prueba**.',
        'Añádelo en **Público › Usuarios de prueba**, o pasa la app a **producción** (paso 4).'
      ],
      stepId: 'publico'
    },
    {
      id: 'no-verificada',
      question: 'Google dice «Google no ha verificado esta app»',
      answer: [
        'Es normal en una herramienta interna que no ha pasado la verificación de marca de Google. Pulsa **Configuración avanzada › Ir a YoutubeMeta (no seguro)**.',
        'La app es tuya y los permisos solo dan acceso a subir y leer tu canal.'
      ],
      stepId: 'conectar'
    },
    {
      id: 'publicar-gris',
      question: 'El botón «Publicar app» está gris y no me deja pasar a producción',
      symptom:
        'Se requieren un nombre de app, un correo electrónico de asistencia, una URL de página principal y una URL de política de privacidad válidos para cambiar la app al modo de producción externo.',
      answer: [
        'Para **probar ya**, no hace falta publicar: en esa misma pantalla, **Usuarios de prueba › Add users**, añade el correo de Google dueño del canal y guarda. Con eso ya puedes conectar (el acceso caduca a los 7 días; luego basta con reconectar).',
        'Para **producción**, ve a **Información de la marca** y completa: nombre de la app, correo de asistencia, **Página principal de la aplicación** y **Vínculo a la política de privacidad**. Las dos URL deben ser **https** públicas (no `localhost`) y su dominio debe estar en **Dominios autorizados** de esa misma pantalla.',
        'Si aún no tienes web, sirve cualquier página pública tuya con un texto de privacidad sencillo (por ejemplo una página de Google Sites o de GitHub Pages). Guarda, vuelve a **Público** y el botón **Publicar app** ya estará activo.'
      ],
      stepId: 'publico'
    },
    {
      id: 'siete-dias',
      question: 'El canal se desconecta solo cada 7 días',
      answer: [
        'La app sigue en modo **Prueba**: Google caduca el acceso a los 7 días.',
        'Pásala a producción (paso 4) y vuelve a conectar el canal una vez.'
      ],
      stepId: 'publico'
    },
    {
      id: 'brand-account',
      question: 'No aparece mi canal / se conectó otro canal',
      answer: [
        'Los canales de marca son una cuenta aparte (*Brand Account*). Al conectar, Google muestra la lista de canales: elige el correcto.',
        'Si no aparece, tu usuario no es **propietario o administrador** de la Brand Account. Las personas invitadas solo desde *YouTube Studio › Permisos* no tienen acceso a la API.',
        'Pulsa **+ Añadir canal** y elige el correcto. Si se conectó uno que no querías, **Quítalo** de la lista.'
      ],
      stepId: 'conectar'
    },
    {
      id: 'sin-canal',
      question: '«La cuenta no tiene canal de YouTube»',
      answer: ['La cuenta de Google elegida no tiene canal. Créalo en [youtube.com](https://www.youtube.com) (menú de la cuenta › Crear un canal) o elige otra cuenta.'],
      stepId: 'conectar'
    },
    {
      id: 'largos',
      question: 'No puedo subir videos de más de 15 minutos',
      answer: ['YouTube exige un canal **verificado** por teléfono para videos largos. Verifícalo en [youtube.com/verify](https://www.youtube.com/verify).']
    },
    {
      id: 'cuota',
      question: '«Se alcanzó la cuota diaria» / uploadLimitExceeded',
      answer: [
        'YouTube limita cuántos videos se suben por día **por proyecto de Google** (todos tus canales suman). El contador de **Conexiones** muestra el uso de hoy y qué canal lo gastó.',
        'La cuota se reinicia a medianoche **hora del Pacífico**. Las publicaciones pendientes esperan y continúan solas.',
        'Si necesitas más, se pide en el mismo formulario de auditoría (paso 8). No crees otros proyectos para sumar cuota: las políticas de YouTube exigen un solo proyecto por aplicación.'
      ]
    },
    {
      id: 'reconectar',
      question: 'La tarjeta dice «Reconectar»',
      answer: [
        'Google rechazó el acceso guardado: se revocó el permiso, cambió la contraseña de la cuenta o la app seguía en modo Prueba.',
        'Pulsa **Reconectar** en esa fila y elige el **mismo** canal: las publicaciones pendientes continúan. Los demás canales no se ven afectados.'
      ],
      stepId: 'conectar'
    }
  ]
};
