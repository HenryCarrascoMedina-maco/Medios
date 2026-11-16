import { IGuide, IShotNavItem } from './guide.models';

/** Menú de una app en TikTok for Developers. */
function appMenu(active: string, mark?: number): IShotNavItem[] {
  const items = ['App details', 'Products', 'Scopes', 'Sandbox', 'App review'];
  return items.map(label => (label === active ? { label, active: true, mark } : { label }));
}

export const TIKTOK_GUIDE: IGuide = {
  platform: 'tiktok',
  title: 'Conectar cuentas de TikTok',
  intro:
    'TikTok se conecta con su inicio de sesión (Login Kit), igual que YouTube con Google. **Una sola vez** se crea una app en TikTok for Developers y se guardan sus claves; ' +
    'después cada cuenta se añade con un botón. Ojo: TikTok exige que la dirección de vuelta sea **https**, y hasta que TikTok **audite** la app los videos solo se publican como «Solo yo».',
  duration: '30 minutos la primera vez; 1 minuto por cada cuenta',
  requirements: [
    'Una cuenta de TikTok para entrar en [developers.tiktok.com](https://developers.tiktok.com).',
    'Una dirección **https** que llegue a la API de YoutubeMeta: el dominio del IIS con certificado o, en local, un túnel (paso 5).',
    'Páginas públicas de **Términos** y **Política de privacidad** (https) para la ficha de la app.'
  ],
  steps: [
    {
      id: 'registro',
      title: 'Entra en TikTok for Developers y crea la app',
      link: { label: 'Abrir Manage apps', url: 'https://developers.tiktok.com/apps/' },
      summary: 'La app es lo que TikTok muestra cuando alguien conecta su cuenta.',
      actions: [
        'Entra en **developers.tiktok.com** con tu cuenta de TikTok y acepta los términos de desarrollador.',
        'Ve a **Manage apps › Connect an app** (si te pide una organización, créala con el nombre de la empresa).',
        'Nombre: `YoutubeMeta`. Pulsa **Confirm**.'
      ],
      shot: {
        url: 'developers.tiktok.com/apps',
        title: 'Manage apps',
        buttons: [{ label: 'Connect an app', primary: true, mark: 2 }],
        blocks: [{ kind: 'field', label: 'App name', value: 'YoutubeMeta', mark: 3 }]
      },
      check: 'Ves el panel de la app con las secciones **App details**, **Products** y **Scopes**.'
    },
    {
      id: 'ficha',
      title: 'Completa la ficha de la app',
      summary: 'TikTok no deja enviar la app a revisión ni usar el Sandbox sin estos datos.',
      actions: [
        '**App details**: icono (1024×1024), categoría y una descripción breve («Publicación de videos propios desde nuestra herramienta interna»).',
        '**Terms of Service URL** y **Privacy Policy URL**: páginas https de tu empresa.',
        '**Platforms**: marca **Web** y pon la URL https de tu sitio.'
      ],
      shot: {
        url: 'developers.tiktok.com/app/…/details',
        sidebar: appMenu('App details', 1),
        title: 'App details',
        blocks: [
          { kind: 'field', label: 'Category', value: 'Business', mark: 1 },
          { kind: 'field', label: 'Terms of Service URL', value: 'https://tuempresa.com/terminos', mark: 2 },
          { kind: 'field', label: 'Privacy Policy URL', value: 'https://tuempresa.com/privacidad', mark: 2 },
          { kind: 'check', label: 'Web · https://tuempresa.com', checked: true, mark: 3 }
        ]
      },
      check: 'La ficha no muestra campos en rojo.'
    },
    {
      id: 'productos',
      title: 'Añade Login Kit y Content Posting API',
      summary: 'Login Kit permite conectar cuentas; Content Posting API, publicar.',
      actions: [
        '**Products › Add products**: añade **Login Kit** y **Content Posting API**.',
        'En **Login Kit › Redirect URI** pega exactamente: `{{tiktokRedirectUri}}` (si sale «…», primero haz el paso 5).',
        'En **Content Posting API** activa **Direct Post**.',
        'En **Scopes** comprueba que están `user.info.basic`, `video.publish` y `video.upload`.'
      ],
      shot: {
        url: 'developers.tiktok.com/app/…/products',
        sidebar: appMenu('Products', 1),
        title: 'Products',
        blocks: [
          { kind: 'row', label: 'Login Kit', sub: 'Redirect URI: https://…/api/Connection/Tiktok/Callback', mark: 2 },
          { kind: 'row', label: 'Content Posting API', sub: 'Direct Post: activado', mark: 3 },
          { kind: 'check', label: 'user.info.basic', checked: true, mark: 4 },
          { kind: 'check', label: 'video.publish', checked: true, mark: 4 },
          { kind: 'check', label: 'video.upload', checked: true, mark: 4 }
        ]
      },
      check: 'Los dos productos aparecen en **Products** y los tres scopes en **Scopes**.',
      copy: 'tiktokRedirectUri',
      faqIds: ['redirect-https', 'redirect-mismatch']
    },
    {
      id: 'claves',
      title: 'Guarda el Client key y el Client secret en YoutubeMeta',
      link: { label: 'Abrir Ajustes', url: '/settings' },
      summary: 'Están en la cabecera de la app en TikTok for Developers (**Client key** y **Client secret**, este con el ojo para mostrarlo).',
      actions: [
        'Copia el **Client key** y el **Client secret** de la app.',
        'En YoutubeMeta abre **⚙️ Ajustes › Plataformas › TikTok** y pégalos.',
        'Pulsa **Guardar**: la etiqueta pasa a **Guardada aquí**.'
      ],
      shot: {
        url: 'YoutubeMeta › Ajustes › Plataformas',
        sidebar: [{ label: 'Biblioteca' }, { label: 'Publicaciones' }, { label: 'Conexiones' }, { label: 'Ajustes', active: true, mark: 2 }],
        title: '♪ TikTok',
        blocks: [
          { kind: 'field', label: 'Client key', value: 'aw1b2c3d4e5f…', mark: 2 },
          { kind: 'secret', label: 'Secreto: ••••••••', mark: 2 }
        ],
        buttons: [{ label: 'Guardar', primary: true, mark: 3 }]
      },
      check: 'En **Ajustes**, TikTok dice **Guardada aquí**.',
      faqIds: ['no-configurado']
    },
    {
      id: 'servidor',
      title: 'Configura la dirección https de vuelta (RedirectUri)',
      summary:
        'TikTok solo vuelve a direcciones **https** registradas. Se configura en el servidor (no en Ajustes) porque depende de dónde está instalada la API.',
      actions: [
        '**IIS con dominio y certificado** (recomendado): variable de entorno del app pool `Tiktok__RedirectUri` = `https://TU-DOMINIO/api/Connection/Tiktok/Callback`.',
        '**En local**: abre un túnel https hacia `http://localhost:5080` (por ejemplo `cloudflared tunnel --url http://localhost:5080`) y usa la dirección que te da: `dotnet user-secrets set "Tiktok:RedirectUri" "https://xxxx.trycloudflare.com/api/Connection/Tiktok/Callback"`.',
        'Pon **la misma** dirección en **Login Kit › Redirect URI** (paso 3) y reinicia la API.',
        'Abre YoutubeMeta desde la dirección que configuraste en `App:FrontBaseUrl` para volver a la misma pantalla tras conectar.'
      ],
      check: 'En **Ajustes › TikTok** se ve la **URI de redirección** que empieza por `https://`.',
      notes: ['Un túnel gratuito cambia de dirección cada vez que se reinicia: tendrías que actualizarla en TikTok y en user-secrets. Para uso diario, usa el dominio del IIS.'],
      faqIds: ['redirect-https']
    },
    {
      id: 'sandbox',
      title: 'Prueba con el Sandbox (antes de la auditoría)',
      summary: 'Sin auditoría TikTok permite probar con cuentas autorizadas y solo publica como **Solo yo**.',
      actions: [
        'En la app abre **Sandbox › Create sandbox**.',
        'En **Target users** añade las cuentas de TikTok con las que vas a probar.',
        'En esas cuentas pon el perfil en **privado** (TikTok › Ajustes › Privacidad › Cuenta privada): sin auditar, TikTok solo publica en cuentas privadas.'
      ],
      shot: {
        url: 'developers.tiktok.com/app/…/sandbox',
        sidebar: appMenu('Sandbox', 1),
        title: 'Sandbox',
        blocks: [
          { kind: 'row', label: 'Target users', sub: '@tumarca', button: 'Add', mark: 2 },
          { kind: 'note', tone: 'warn', text: 'Unaudited: posts are restricted to SELF_ONLY. Up to 5 users per 24 h.' }
        ]
      },
      check: 'Tu cuenta figura en **Target users**.',
      faqIds: ['solo-yo', 'cinco-usuarios']
    },
    {
      id: 'conectar',
      title: 'Conecta la cuenta',
      summary: 'En **Conexiones**. Repite por cada cuenta de TikTok.',
      actions: [
        'En la tarjeta de TikTok pulsa **+ Añadir cuenta**.',
        'TikTok pide iniciar sesión y muestra los permisos de **YoutubeMeta**: pulsa **Autorizar**.',
        'Vuelves a Conexiones con la cuenta añadida. Pulsa **Probar**.'
      ],
      shot: {
        url: 'www.tiktok.com/v2/auth/authorize',
        title: 'YoutubeMeta quiere acceder a tu cuenta de TikTok',
        blocks: [
          { kind: 'check', label: 'Leer la información de tu perfil', checked: true },
          { kind: 'check', label: 'Publicar contenido en TikTok', checked: true, mark: 2 },
          { kind: 'check', label: 'Subir contenido a TikTok (borradores)', checked: true, mark: 2 }
        ],
        buttons: [{ label: 'Autorizar', primary: true, mark: 2 }]
      },
      check: 'La tarjeta de TikTok muestra la cuenta (@usuario) con **Conectada**.',
      faqIds: ['scope', 'redirect-mismatch']
    },
    {
      id: 'publicar',
      title: 'Cómo se publica en TikTok',
      summary: 'Desde el detalle de un video: **Publicar en varias cuentas** y marca la cuenta de TikTok. El formulario sigue las reglas que TikTok exige a las apps.',
      actions: [
        '**Publicar directamente** o **Enviar como borrador**: el borrador llega como notificación a la app para terminarlo allí (música, efectos).',
        '**¿Quién puede verlo?**: no viene elegido; solo salen las opciones que permite tu cuenta.',
        '**Comentar / Dúo / Stitch**: desmarcados por defecto; en gris si la cuenta los tiene desactivados.',
        '**Contenido comercial**: márcalo si promocionas algo. «Tu marca» se etiqueta como contenido promocional; «de un tercero», como colaboración pagada (no puede ser privada).',
        'El **texto** del video es el título (hasta 2200 caracteres). **Programar** lo hace YoutubeMeta a la hora indicada.'
      ],
      check: 'En **Publicaciones** la fila pasa a **Publicado**; si fue privado, verás el aviso «Publicado como privado».',
      notes: ['Al publicar aceptas la **Confirmación de uso de música** de TikTok (y su política de contenido de marca si es colaboración pagada).'],
      faqIds: ['solo-yo', 'borradores', 'muchas-publicaciones']
    },
    {
      id: 'auditoria',
      title: 'Solicita la auditoría para publicar en público',
      optional: true,
      link: { label: 'Abrir App review', url: 'https://developers.tiktok.com/apps/' },
      summary: 'Hasta que TikTok audite la app, todo sale como «Solo yo» y como mucho 5 cuentas al día.',
      actions: [
        'En la app abre **App review** y completa la descripción de uso y un **video de demostración** del flujo (conectar cuenta y publicar desde YoutubeMeta).',
        'Envía a revisión. TikTok responde por correo (suele tardar días).',
        'Una vez aprobada, no hay que cambiar nada en YoutubeMeta.'
      ],
      check: 'En **App review** el estado es **Approved** y la privacidad «Todo el mundo» aparece al publicar.',
      faqIds: ['solo-yo']
    },
    {
      id: 'cambiar',
      title: 'Más cuentas, ★ por defecto y quitar',
      optional: true,
      summary: 'Todas las cuentas usan la misma app de TikTok.',
      actions: [
        '**+ Añadir cuenta** y, en TikTok, inicia sesión con la otra cuenta (cierra antes sesión en tiktok.com si entra sola la anterior).',
        '**★ Marcar por defecto** y **✎ Nombre corto** como en las demás plataformas.',
        '**Quitar** revoca el acceso en TikTok y cancela solo lo pendiente de esa cuenta.'
      ],
      check: 'Cada cuenta aparece en su fila dentro de la tarjeta de TikTok.',
      notes: ['El acceso de TikTok dura **180 días** sin uso; YoutubeMeta lo renueva solo al publicar y en la prueba semanal.'],
      faqIds: ['reconectar']
    },
    {
      id: 'imagenes',
      title: 'Publicar fotos: dominio público y verificado en TikTok',
      optional: true,
      summary: 'TikTok no recibe las fotos como archivo: las descarga desde una dirección pública, y además exige que ese dominio esté verificado en su portal.',
      actions: [
        'Publica YoutubeMeta en un dominio con **https** y pide que se configure `App:PublicBaseUrl` con esa dirección.',
        'En **TikTok for Developers ›** tu app, busca **URL properties** (o «Manage URL properties»; puede cambiar; revisa el portal) y añade el dominio.',
        'TikTok te da un archivo o un registro DNS para demostrar que el dominio es tuyo. Pide a quien administra el dominio que lo coloque y pulsa **Verify**.',
        'Cuando el dominio aparezca como verificado, las fotos de TikTok dejan de mostrar el aviso de dominio en el diálogo.'
      ],
      check: 'El dominio aparece como **Verified** en URL properties y TikTok aparece disponible al elegir imágenes.',
      notes: ['En localhost no se pueden publicar fotos en TikTok; los videos sí.']
    }
  ],
  faqs: [
    {
      id: 'redirect-https',
      question: 'TikTok no acepta mi Redirect URI con http://localhost',
      answer: [
        'TikTok exige **https** en las direcciones de vuelta. En local usa un túnel https (por ejemplo `cloudflared tunnel --url http://localhost:5080`) y pon su dirección + `/api/Connection/Tiktok/Callback`.',
        'En producción usa el dominio del IIS con certificado. Ver **paso 5**.'
      ],
      stepId: 'servidor'
    },
    {
      id: 'redirect-mismatch',
      question: 'TikTok dice que la redirect_uri no coincide',
      answer: [
        'La dirección de **Login Kit › Redirect URI** y la de `Tiktok:RedirectUri` del servidor deben ser **idénticas** (https, dominio, ruta y sin barra final).',
        'Copia la que muestra **Ajustes › TikTok** y pégala tal cual en TikTok for Developers.'
      ],
      stepId: 'productos'
    },
    {
      id: 'no-configurado',
      question: '«Falta la app de TikTok» o el botón Añadir cuenta está gris',
      symptom: 'Falta configurar el cliente de TikTok (Ajustes › Plataformas) y su RedirectUri https.',
      answer: ['Faltan el Client key y el secreto (**paso 4**) o la RedirectUri https del servidor (**paso 5**). Con las dos cosas el botón se activa.'],
      stepId: 'claves'
    },
    {
      id: 'solo-yo',
      question: 'El video salió como «Solo yo» o «Sin la auditoría solo se puede publicar en cuentas privadas»',
      symptom: 'Sin la auditoría de TikTok solo se puede publicar en cuentas privadas y como «Solo yo».',
      answer: [
        'Es la regla de TikTok para apps **sin auditar**: todo se publica como privado y la cuenta debe ser privada.',
        'Mientras tanto puedes cambiar la visibilidad a mano en la app de TikTok, o usar **Enviar como borrador** y publicarlo tú desde el móvil.',
        'Para publicar en público, solicita la auditoría (**paso 9**).'
      ],
      stepId: 'auditoria'
    },
    {
      id: 'cinco-usuarios',
      question: '«Sin auditoría, TikTok permite publicar con como mucho 5 cuentas al día»',
      answer: ['Límite de TikTok para apps sin auditar. Espera 24 h o solicita la auditoría.'],
      stepId: 'sandbox'
    },
    {
      id: 'borradores',
      question: '«Hay 5 borradores pendientes en la bandeja de TikTok»',
      answer: ['TikTok permite como mucho 5 borradores sin terminar en 24 h. Abre la app de TikTok, termina o descarta los borradores de la bandeja y reintenta.'],
      stepId: 'publicar'
    },
    {
      id: 'muchas-publicaciones',
      question: '«La cuenta alcanzó el máximo de publicaciones diarias de TikTok»',
      answer: ['TikTok limita las publicaciones por API por cuenta y día (unas 15). La publicación queda **Esperando cuota** y se reintenta sola.'],
      stepId: 'publicar'
    },
    {
      id: 'scope',
      question: '«La cuenta no concedió todos los permisos»',
      answer: [
        'En la pantalla de TikTok se desmarcó algún permiso, o la app no tiene los scopes `video.publish` / `video.upload` (paso 3).',
        'Revisa los scopes y vuelve a conectar la cuenta aceptando todo.'
      ],
      stepId: 'conectar'
    },
    {
      id: 'reconectar',
      question: 'La cuenta de TikTok dice «Reconectar»',
      answer: [
        'TikTok rechazó el acceso guardado: pasaron más de 180 días sin uso, se quitó el permiso en la app o cambiaron las claves de la app.',
        'Pulsa **Reconectar** y entra con la **misma** cuenta: lo pendiente continúa.'
      ],
      stepId: 'cambiar'
    },
    {
      id: 'formato',
      question: 'TikTok no admite el formato del video',
      answer: ['TikTok acepta MP4, MOV o WebM (H.264/H.265), de 23 a 60 fps, de 360 a 4096 píxeles por lado y hasta 4 GB. La duración máxima depende de la cuenta (el formulario la muestra).']
    },
    {
      id: 'dominio-publico',
      question: '«Necesita que la app esté publicada en un dominio (dirección pública)»',
      symptom: 'necesita que la app esté publicada en un dominio',
      answer: [
        'TikTok descarga las fotos desde una dirección pública que además tiene que estar **verificada** en su portal (URL properties).',
        'Configura `App:PublicBaseUrl` y verifica el dominio siguiendo el paso «Publicar fotos».'
      ],
      stepId: 'imagenes'
    }
  ]
};
