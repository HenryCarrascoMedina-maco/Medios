/**
 * Guías paso a paso. El texto admite un marcado mínimo (ver RichTextPipe):
 * **negrita**, `código`, [texto](url) y {{variable}} (valores reales del servidor, p. ej. {{redirectUri}}).
 */
export type GuidePlatform = 'youtube' | 'facebook' | 'instagram' | 'telegram' | 'tiktok' | 'linkedin' | 'teams' | 'whatsapp';

export interface IGuide {
  platform: GuidePlatform;
  title: string;
  intro: string;
  duration: string;
  requirements: string[];
  steps: IGuideStep[];
  faqs: IGuideFaq[];
}

export interface IGuideStep {
  id: string;
  title: string;
  /** Enlace directo a la pantalla donde se hace el paso. */
  link?: { label: string; url: string };
  summary: string;
  /** Acciones en orden; el número coincide con las marcas rojas de la captura. */
  actions: string[];
  shot?: IGuideShot;
  check: string;
  /** Avisos importantes del paso. */
  notes?: string[];
  /** ids de preguntas frecuentes relacionadas. */
  faqIds?: string[];
  /** Paso opcional (por ejemplo, solo si cambias de cuenta). */
  optional?: boolean;
  /** Variable del servidor que el paso ofrece copiar (p. ej. redirectUri). */
  copy?: string;
}

export interface IGuideFaq {
  id: string;
  question: string;
  /** Mensaje literal que suele ver el usuario; ayuda a encontrar la respuesta con el buscador. */
  symptom?: string;
  answer: string[];
  image?: { src: string; caption: string };
  shot?: IGuideShot;
  stepId?: string;
}

/**
 * Captura esquemática: reproduce la pantalla con los textos reales de los menús y marca con
 * números dónde pulsar. `image` usa una captura real en su lugar.
 */
export interface IGuideShot {
  url: string;
  caption?: string;
  image?: string;
  sidebar?: IShotNavItem[];
  title?: string;
  buttons?: IShotButton[];
  blocks?: IShotBlock[];
}

export interface IShotNavItem {
  label: string;
  group?: boolean;
  active?: boolean;
  mark?: number;
}

export interface IShotButton {
  label: string;
  primary?: boolean;
  disabled?: boolean;
  mark?: number;
}

export type IShotBlock =
  | { kind: 'row'; label: string; sub?: string; button?: string; mark?: number; selected?: boolean }
  | { kind: 'field'; label: string; value: string; mark?: number }
  | { kind: 'check'; label: string; checked: boolean; mark?: number }
  | { kind: 'option'; label: string; sub?: string; checked: boolean; mark?: number }
  | { kind: 'note'; text: string; tone: 'info' | 'warn' | 'ok' | 'error' }
  | { kind: 'secret'; label: string; mark?: number }
  | { kind: 'heading'; text: string };
