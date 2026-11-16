import { IGuide, IShotNavItem } from './guide.models';

/** Pestañas de una app en LinkedIn Developers. */
function appTabs(active: string, mark?: number): IShotNavItem[] {
  const items = ['Settings', 'Auth', 'Products', 'Analytics', 'Team members'];
  return items.map(label => (label === active ? { label, active: true, mark } : { label }));
}

const PORTAL_MAY_CHANGE = 'LinkedIn cambia a veces los nombres y la posición de los botones. Si algo no coincide, busca el texto parecido en la misma pantalla (puede cambiar; revisa el portal).';

export const LINKEDIN_GUIDE: IGuide = {
  platform: 'linkedin',
  title: 'Conectar LinkedIn (perfil personal y página de empresa)',
  intro:
    'LinkedIn se conecta con su propio inicio de sesión, igual que YouTube con Google. Hay **dos formas** y cada una usa **su propia app** en el portal de desarrolladores de LinkedIn: ' +
    '**(A) perfil personal**, que puedes usar el mismo día sin esperar a nadie, y **(B) página de empresa**, que necesita que LinkedIn **revise y apruebe** la app. ' +
    'Haz primero la parte A; la B puedes dejarla para cuando LinkedIn te dé el visto bueno. Importante: LinkedIn **no deja renovar el acceso solo**, así que cada **60 días** hay que pulsar «Reconectar» (YoutubeMeta avisa 10 días antes).',
  duration: 'Parte A: 20–30 minutos. Parte B: 30 minutos de trámites y luego esperar la respuesta de LinkedIn (días o semanas)',
  requirements: [
    'Una cuenta personal de LinkedIn con la que entres normalmente en [linkedin.com](https://www.linkedin.com).',
    'Una **página de empresa** en LinkedIn de la que seas administrador: LinkedIn obliga a asociar cada app a una página, aunque solo vayas a publicar en tu perfil. Si no tienes, el **paso 1** explica cómo crearla gratis.',
    'Un logotipo cuadrado (PNG o JPG, por ejemplo 300×300) para la app.',
    'Acceso a **Ajustes › Plataformas** en YoutubeMeta (ahí se pegan las claves y ahí se ve la URL de retorno).'
  ],
  steps: [
    // ── PARTE A · PERFIL PERSONAL ──────────────────────────────────────────
    {
      id: 'pagina',
      title: 'Parte A · Si no tienes página de empresa, créala',
      optional: true,
      link: { label: 'Crear una página de LinkedIn', url: 'https://www.linkedin.com/company/setup/new/' },
      summary: 'LinkedIn no deja crear una app sin asociarla a una página de empresa. Si ya administras una, salta este paso.',
      actions: [
        'Entra en **linkedin.com** con tu cuenta.',
        'Arriba a la derecha pulsa **Para negocios** (el icono de cuadrícula) y elige **Crear una página de empresa** (puede cambiar; revisa el portal).',
        'Elige **Empresa** (o «Institución educativa» si es tu caso).',
        'Rellena **Nombre**, la dirección `linkedin.com/company/…` (sin espacios), el **sitio web**, el **sector**, el **tamaño** y el **tipo** de organización. Sube el logotipo.',
        'Marca la casilla que confirma que puedes actuar en nombre de la organización y pulsa **Crear página**.'
      ],
      shot: {
        url: 'linkedin.com/company/setup/new',
        title: 'Crear una página de LinkedIn',
        blocks: [
          { kind: 'field', label: 'Nombre', value: 'Mi Empresa', mark: 4 },
          { kind: 'field', label: 'linkedin.com/company/', value: 'mi-empresa', mark: 4 },
          { kind: 'check', label: 'Verifico que soy un representante autorizado…', checked: true, mark: 5 }
        ],
        buttons: [{ label: 'Crear página', primary: true, mark: 5 }]
      },
      check: 'Ves tu nueva página y, arriba, el aviso «Estás viendo esto como administrador».',
      notes: ['La página puede estar casi vacía: solo hace falta para asociar la app. Nadie tiene que seguirla.']
    },
    {
      id: 'app',
      title: 'Crea la app en LinkedIn Developers',
      link: { label: 'Abrir LinkedIn Developers', url: 'https://www.linkedin.com/developers/apps' },
      summary: 'La app es lo que LinkedIn enseña cuando alguien conecta su perfil a YoutubeMeta.',
      actions: [
        'Abre **https://www.linkedin.com/developers/apps** y pulsa **Create app**.',
        '**App name**: `YoutubeMeta` (o el nombre de tu empresa).',
        '**LinkedIn Page**: escribe el nombre de tu página de empresa y elígela de la lista (la del paso 1 o la que ya administras).',
        '**Privacy policy URL**: opcional; si tienes una página de privacidad, pégala.',
        '**App logo**: sube el logotipo cuadrado.',
        'Marca **I have read and agree to these terms** y pulsa **Create app**.'
      ],
      shot: {
        url: 'linkedin.com/developers/apps/new',
        title: 'Create an app',
        blocks: [
          { kind: 'field', label: 'App name', value: 'YoutubeMeta', mark: 2 },
          { kind: 'field', label: 'LinkedIn Page', value: 'Mi Empresa', mark: 3 },
          { kind: 'field', label: 'App logo', value: 'logo.png', mark: 5 },
          { kind: 'check', label: 'I have read and agree to these terms', checked: true, mark: 6 }
        ],
        buttons: [{ label: 'Create app', primary: true, mark: 6 }]
      },
      check: 'Estás dentro de la app y ves arriba las pestañas **Settings**, **Auth** y **Products**.',
      notes: [PORTAL_MAY_CHANGE],
      faqIds: ['sin-pagina']
    },
    {
      id: 'verificar',
      title: 'Verifica que la app pertenece a tu página',
      summary: 'LinkedIn pide que un administrador de la página confirme la app. Algunos productos no se activan sin esto.',
      actions: [
        'En la pestaña **Settings**, junto a la página asociada, pulsa **Verify** (puede cambiar; revisa el portal).',
        'LinkedIn genera un **enlace de verificación**. Pulsa **Copy URL**.',
        'Abre ese enlace con la cuenta que es **superadministrador** de la página (si eres tú, ábrelo en esta misma ventana) y pulsa **Verify**.',
        'Vuelve a la app y recarga la página.'
      ],
      shot: {
        url: 'linkedin.com/developers/apps/…/settings',
        sidebar: appTabs('Settings', 1),
        title: 'Settings',
        blocks: [
          { kind: 'row', label: 'LinkedIn Page: Mi Empresa', sub: 'Not verified', button: 'Verify', mark: 1 },
          { kind: 'note', text: 'Send this URL to a Page Admin to verify', tone: 'info' }
        ]
      },
      check: 'En **Settings** la página aparece como **Verified**.',
      notes: ['Si el superadministrador es otra persona, envíale el enlace. El enlace caduca pasado un tiempo: si falla, genera otro.']
    },
    {
      id: 'productos',
      title: 'Añade los productos «Sign In with LinkedIn using OpenID Connect» y «Share on LinkedIn»',
      summary: 'El primero permite conectar tu perfil; el segundo, publicar en él. Los dos son de autoservicio: se activan al momento.',
      actions: [
        'Abre la pestaña **Products**.',
        'Busca **Sign In with LinkedIn using OpenID Connect** y pulsa **Request access**. Acepta las condiciones.',
        'Busca **Share on LinkedIn** y pulsa **Request access**. Acepta las condiciones.',
        'Espera unos segundos y recarga: los dos deben aparecer en **Added products**.'
      ],
      shot: {
        url: 'linkedin.com/developers/apps/…/products',
        sidebar: appTabs('Products', 1),
        title: 'Products',
        blocks: [
          { kind: 'row', label: 'Sign In with LinkedIn using OpenID Connect', sub: 'Standard tier', button: 'Request access', mark: 2 },
          { kind: 'row', label: 'Share on LinkedIn', sub: 'Default tier', button: 'Request access', mark: 3 },
          { kind: 'note', text: 'No añadas aquí «Community Management API»: va en otra app (parte B).', tone: 'warn' }
        ]
      },
      check: 'En la pestaña **Auth**, apartado **OAuth 2.0 scopes**, aparecen `openid`, `profile` y `w_member_social`.',
      notes: [PORTAL_MAY_CHANGE],
      faqIds: ['scope-no-autorizado']
    },
    {
      id: 'redirect',
      title: 'Pega la URL de retorno en la pestaña Auth',
      summary: 'Es la dirección a la que LinkedIn devuelve a la persona tras dar permiso. Tiene que coincidir letra por letra.',
      copy: 'linkedinRedirectUri',
      actions: [
        'En YoutubeMeta, abre **Ajustes › Plataformas › LinkedIn · perfil personal** y copia la **URI de redirección**. Es esta: `{{linkedinRedirectUri}}` (si ves «…», guarda antes el Client ID del paso siguiente y vuelve).',
        'En la app de LinkedIn abre la pestaña **Auth**.',
        'En **OAuth 2.0 settings › Authorized redirect URLs for your app** pulsa el lápiz (editar) y luego **Add redirect URL**.',
        'Pega la dirección tal cual, sin espacios al principio ni al final, y pulsa **Update**.'
      ],
      shot: {
        url: 'linkedin.com/developers/apps/…/auth',
        sidebar: appTabs('Auth', 2),
        title: 'Auth',
        blocks: [
          { kind: 'heading', text: 'OAuth 2.0 settings' },
          { kind: 'field', label: 'Authorized redirect URLs for your app', value: 'https://…/api/Connection/Linkedin/Callback', mark: 4 }
        ],
        buttons: [{ label: 'Add redirect URL', mark: 3 }, { label: 'Update', primary: true, mark: 4 }]
      },
      check: 'La dirección aparece en la lista **Authorized redirect URLs for your app**.',
      faqIds: ['redirect-no-coincide']
    },
    {
      id: 'claves',
      title: 'Copia el Client ID y el Primary Client Secret en Ajustes',
      summary: 'Son el «usuario» y la «contraseña» de la app. YoutubeMeta los guarda cifrados.',
      actions: [
        'En la pestaña **Auth**, apartado **Application credentials**, copia el **Client ID**.',
        'En YoutubeMeta ve a **Ajustes › Plataformas › LinkedIn · perfil personal** y pégalo en **Client ID**.',
        'Vuelve a LinkedIn, pulsa el icono del ojo junto a **Primary Client Secret** y cópialo.',
        'Pégalo en **Secreto** y pulsa **Guardar**.'
      ],
      shot: {
        url: 'linkedin.com/developers/apps/…/auth',
        sidebar: appTabs('Auth'),
        title: 'Application credentials',
        blocks: [
          { kind: 'field', label: 'Client ID', value: '86ab…f2', mark: 1 },
          { kind: 'secret', label: 'Primary Client Secret', mark: 3 }
        ]
      },
      check: 'En Ajustes, la tarjeta **LinkedIn · perfil personal** muestra **Guardada aquí**.',
      notes: ['El secreto es como una contraseña: no lo envíes por correo ni lo pegues en chats.']
    },
    {
      id: 'conectar',
      title: 'Conecta tu perfil en Cuentas',
      summary: 'Ahora sí: el botón de LinkedIn ya funciona.',
      actions: [
        'En YoutubeMeta abre **Conexiones** y busca la tarjeta **LinkedIn**.',
        'Pulsa **Conectar perfil**. Se abre la pantalla de LinkedIn.',
        'Entra con tu cuenta (si no lo estabas) y pulsa **Permitir** para aceptar **todos** los permisos.',
        'Vuelves solo a YoutubeMeta con el aviso de conexión completada.'
      ],
      shot: {
        url: 'localhost:4200/connections',
        title: 'LinkedIn',
        buttons: [{ label: 'Conectar perfil', primary: true, mark: 2 }, { label: 'Conectar página de empresa' }],
        blocks: [{ kind: 'row', label: 'Tu nombre', sub: 'Perfil personal · conectada', selected: true }]
      },
      check: 'Tu perfil aparece en la tarjeta de LinkedIn como **Conectada**, con la nota «Perfil personal».',
      faqIds: ['permisos-incompletos']
    },
    {
      id: 'probar',
      title: 'Haz una publicación de prueba',
      summary: 'Comprueba que todo funciona antes de programar nada importante.',
      actions: [
        'Ve a **Medios** y pulsa **Nueva publicación**.',
        'Escribe un texto corto, por ejemplo «Prueba», y marca tu perfil de LinkedIn en **¿Dónde se publica?**.',
        'En la pestaña de LinkedIn elige **Solo mis contactos** si prefieres que la prueba la vea poca gente.',
        'Marca el consentimiento y pulsa **Publicar**. En **Publicaciones** verás el avance; al terminar aparece el enlace al post.'
      ],
      check: 'El post aparece en tu perfil de LinkedIn. Puedes borrarlo desde LinkedIn cuando quieras.'
    },
    {
      id: 'renovar',
      title: 'Cada 60 días: reconectar',
      summary: 'LinkedIn da acceso por 60 días y no deja renovarlo automáticamente con este tipo de app.',
      actions: [
        'Desde 10 días antes, la tarjeta de la cuenta muestra **Caduca en N días**.',
        'Pulsa **Reconectar** en esa tarjeta y acepta en LinkedIn. Tarda unos segundos y no se pierde nada.',
        'Si se te pasa, la cuenta muestra **Caducada · Reconectar** y lo que estaba en cola espera; al reconectar continúa solo.'
      ],
      check: 'Tras reconectar, el aviso de caducidad desaparece.',
      faqIds: ['caduca']
    },

    // ── PARTE B · PÁGINA DE EMPRESA ────────────────────────────────────────
    {
      id: 'empresa-app',
      title: 'Parte B · Crea una SEGUNDA app para la página de empresa',
      link: { label: 'Abrir LinkedIn Developers', url: 'https://www.linkedin.com/developers/apps' },
      summary: 'Publicar como página necesita el producto «Community Management API», que LinkedIn revisa a mano y que debe ir en una app aparte (no se mezcla con los productos de la parte A).',
      actions: [
        'En **https://www.linkedin.com/developers/apps** pulsa otra vez **Create app**.',
        'Nombre, por ejemplo, `YoutubeMeta Empresa`. Asóciala a la **página de empresa** donde vas a publicar y sube el logotipo.',
        'Verifica la app con la página como en el **paso 3** (Settings › Verify).',
        'En **Products** pulsa **Request access** en **Community Management API**.'
      ],
      shot: {
        url: 'linkedin.com/developers/apps/…/products',
        sidebar: appTabs('Products', 4),
        title: 'Products',
        blocks: [
          { kind: 'row', label: 'Community Management API', sub: 'Requiere revisión de LinkedIn', button: 'Request access', mark: 4 },
          { kind: 'note', text: 'Esta app solo debe tener este producto.', tone: 'warn' }
        ]
      },
      check: 'El producto aparece como solicitado o en revisión.',
      notes: [PORTAL_MAY_CHANGE]
    },
    {
      id: 'empresa-acceso',
      title: 'Rellena la solicitud: primero Development y después Standard',
      summary: 'LinkedIn da el acceso en dos niveles. Con Development ya puedes probar con tu propia página; Standard es el acceso definitivo.',
      actions: [
        'Al pulsar **Request access** se abre un formulario. Indica el **nombre legal de la empresa**, el sitio web, un correo de contacto y para qué usarás la API: «Publicar contenido propio de nuestra empresa en nuestra página de LinkedIn desde una herramienta interna».',
        'LinkedIn puede pedir **verificar la empresa** (documentos o correo del dominio). Responde con los datos reales de la organización.',
        'Cuando LinkedIn conceda **Development tier**, ya puedes hacer los pasos siguientes y conectar tu página para probar.',
        'Para el acceso completo, en la misma pestaña **Products** busca la opción de pedir **Standard tier** (un formulario de revisión; a veces piden un video corto que muestre cómo se usa). Envíalo y espera la respuesta.'
      ],
      check: 'En **Products**, Community Management API aparece como **Added** (Development o Standard).',
      notes: [
        'Los plazos y requisitos los decide LinkedIn y cambian con el tiempo (puede cambiar; revisa el portal). Mientras esperas, usa la parte A sin problema.',
        'El superadministrador de la página tiene que haber verificado la app (paso 3) o la solicitud puede quedarse parada.'
      ],
      faqIds: ['aprobacion-pendiente']
    },
    {
      id: 'empresa-redirect',
      title: 'Pega la URL de retorno de empresa y revisa los permisos',
      summary: 'Esta app tiene su propia dirección de retorno, distinta de la del perfil.',
      copy: 'linkedinOrgRedirectUri',
      actions: [
        'En YoutubeMeta copia la **URI de redirección** de **Ajustes › Plataformas › LinkedIn · páginas de empresa**: `{{linkedinOrgRedirectUri}}`.',
        'En la app de empresa, pestaña **Auth › Authorized redirect URLs for your app**, añádela y pulsa **Update**.',
        'En **OAuth 2.0 scopes** comprueba que están `w_organization_social`, `rw_organization_admin` y `r_organization_social` (aparecen cuando LinkedIn concede el producto).'
      ],
      shot: {
        url: 'linkedin.com/developers/apps/…/auth',
        sidebar: appTabs('Auth', 2),
        title: 'OAuth 2.0 scopes',
        blocks: [
          { kind: 'check', label: 'w_organization_social', checked: true, mark: 3 },
          { kind: 'check', label: 'rw_organization_admin', checked: true, mark: 3 },
          { kind: 'check', label: 'r_organization_social', checked: true, mark: 3 }
        ]
      },
      check: 'La dirección está en la lista y los tres permisos aparecen.',
      faqIds: ['redirect-no-coincide', 'scope-no-autorizado']
    },
    {
      id: 'empresa-claves',
      title: 'Copia las claves de la app de empresa en Ajustes',
      summary: 'Van en una tarjeta distinta de la del perfil.',
      actions: [
        'En la app de empresa, pestaña **Auth › Application credentials**, copia el **Client ID** y el **Primary Client Secret**.',
        'En YoutubeMeta pégalos en **Ajustes › Plataformas › LinkedIn · páginas de empresa** y pulsa **Guardar**.'
      ],
      check: 'La tarjeta **LinkedIn · páginas de empresa** muestra **Guardada aquí**.'
    },
    {
      id: 'empresa-admin',
      title: 'Comprueba que eres administrador de la página',
      summary: 'Solo un administrador (o administrador de contenido) de la página puede conectarla.',
      actions: [
        'Abre tu página en LinkedIn y entra en **Herramientas de administrador › Administrar administradores** (puede cambiar; revisa el portal).',
        'Busca tu nombre: tu rol debe ser **Superadministrador**, **Administrador de contenido** o equivalente.',
        'Si no lo eres, pide a un superadministrador que te añada con ese rol.'
      ],
      check: 'Apareces en la lista de administradores con un rol que permite publicar.'
    },
    {
      id: 'empresa-conectar',
      title: 'Pulsa «Conectar página de empresa»',
      summary: 'Se conectan todas las páginas que administras; después puedes quitar las que no quieras.',
      actions: [
        'En **Conexiones › LinkedIn** pulsa **Conectar página de empresa**.',
        'Entra en LinkedIn con tu cuenta de administrador y pulsa **Permitir** aceptando todos los permisos.',
        'De vuelta en YoutubeMeta aparecen tus páginas con la nota **Página de empresa**.',
        'Si alguna sobra, pulsa **Quitar** en su tarjeta.'
      ],
      check: 'Tu página aparece en la tarjeta de LinkedIn como **Conectada**. Al publicar, la verás en «¿Dónde se publica?».',
      faqIds: ['sin-paginas', 'quitar']
    }
  ],
  faqs: [
    {
      id: 'caduca',
      question: '¿Por qué tengo que reconectar cada 60 días?',
      symptom: 'Caduca en 9 días · Reconectar',
      answer: [
        'LinkedIn entrega accesos de **60 días** y, para apps de autoservicio, no da forma de renovarlos sin que la persona vuelva a entrar.',
        'Reconectar tarda unos segundos: pulsa **Reconectar** en la tarjeta. No se pierde nada y lo que esperaba en cola continúa solo.'
      ],
      stepId: 'renovar'
    },
    {
      id: 'aprobacion-pendiente',
      question: 'LinkedIn todavía no aprobó la app de empresa. ¿Qué hago mientras?',
      answer: [
        'Puedes seguir publicando en tu **perfil personal** con la app de la parte A: no depende de esa aprobación.',
        'El botón **Conectar página de empresa** fallará hasta que LinkedIn conceda al menos el nivel **Development** de Community Management API.',
        'Revisa de vez en cuando la pestaña **Products** de la app de empresa y tu correo: LinkedIn avisa ahí.'
      ],
      stepId: 'empresa-acceso'
    },
    {
      id: 'sin-paginas',
      question: '«Tu usuario no administra ninguna página de empresa en LinkedIn, o LinkedIn aún no aprobó la app de empresa.»',
      symptom: 'no_pages',
      answer: [
        'Tu cuenta no es administradora de ninguna página, o la app de empresa todavía no tiene Community Management API aprobada.',
        'Comprueba tu rol en la página (**paso 14**) y el estado del producto (**paso 11**).'
      ],
      stepId: 'empresa-admin'
    },
    {
      id: 'permisos-incompletos',
      question: '«No se concedieron los permisos necesarios»',
      symptom: 'missing_scope',
      answer: [
        'En la pantalla de LinkedIn se desmarcó algún permiso o la app no tiene el producto correspondiente.',
        'Revisa que la app tiene los productos del **paso 4** (o Community Management API en la de empresa) y vuelve a conectar aceptando todo.'
      ],
      stepId: 'productos'
    },
    {
      id: 'scope-no-autorizado',
      question: 'LinkedIn muestra «unauthorized_scope_error» o «Scope … is not authorized for your application»',
      symptom: 'unauthorized_scope_error',
      answer: [
        'La app no tiene el producto que da ese permiso. En la app del perfil añade **Sign In with LinkedIn using OpenID Connect** y **Share on LinkedIn**.',
        'En la app de empresa, el permiso `w_organization_social` solo llega cuando LinkedIn concede **Community Management API**.'
      ],
      stepId: 'productos'
    },
    {
      id: 'redirect-no-coincide',
      question: 'LinkedIn dice «The redirect_uri does not match the registered value»',
      symptom: 'redirect_uri does not match',
      answer: [
        'La dirección de retorno guardada en la pestaña **Auth** no es exactamente la que muestra YoutubeMeta en Ajustes.',
        'Cópiala otra vez con el botón **Copiar** de Ajustes y pégala sin espacios; fíjate en `http` frente a `https` y en la barra final.',
        'Recuerda que el perfil y la página de empresa usan **direcciones distintas**, cada una en su app.'
      ],
      stepId: 'redirect'
    },
    {
      id: 'sin-pagina',
      question: 'Al crear la app me obliga a elegir una página y no tengo ninguna',
      answer: [
        'Es obligatorio para cualquier app de LinkedIn. Crea una página gratuita siguiendo el **paso 1**; puede quedarse casi vacía.',
        'Si la página es de otra persona, pídele que te haga administrador.'
      ],
      stepId: 'pagina'
    },
    {
      id: 'quitar',
      question: '¿Cómo quito una cuenta o una página de LinkedIn?',
      answer: [
        'En **Conexiones › LinkedIn**, pulsa **Quitar** en su tarjeta. Solo se cancelan las publicaciones que esperaban en esa cuenta.',
        'Si además quieres retirar el permiso en LinkedIn, entra en LinkedIn › **Configuración › Privacidad de datos › Servicios permitidos** (o «Aplicaciones permitidas»; puede cambiar) y elimina la app.'
      ]
    },
    {
      id: 'perfil-como-pagina',
      question: '¿Puedo publicar en la página con la app del perfil?',
      answer: [
        'No. Publicar como página exige el permiso `w_organization_social`, que solo da Community Management API (parte B).',
        'Con la app del perfil solo se publica **en tu nombre**.'
      ]
    },
    {
      id: 'contactos',
      question: '¿Qué significa «Solo mis contactos»?',
      answer: [
        'El post solo lo ven tus contactos de primer grado. Solo existe en perfiles personales: las páginas de empresa siempre publican para **Cualquiera**.'
      ]
    },
    {
      id: 'metricas',
      question: '¿Por qué no veo visualizaciones ni «me gusta» de mi perfil en Resultados?',
      answer: [
        'LinkedIn restringe las estadísticas de perfiles personales. En Resultados verás lo publicado y lo fallido, pero no las cifras.',
        'Las estadísticas llegan con las páginas de empresa (parte B), cuando LinkedIn concede el acceso.'
      ]
    },
    {
      id: 'tipos',
      question: '¿Qué puedo publicar en LinkedIn?',
      answer: [
        'Texto, enlace (con vista previa), una imagen, varias imágenes, un video o un PDF (se ve como carrusel de páginas). El primer comentario es opcional.',
        'LinkedIn corta el texto en el feed a unos 210 caracteres con «…ver más»: pon lo importante al principio.'
      ]
    }
  ]
};
