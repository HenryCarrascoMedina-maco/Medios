/**
 * Íconos SVG en línea (24×24). Los de interfaz son de trazo (estilo Lucide); los de marca, rellenos.
 * Un solo sitio: las plantillas no usan emojis como ícono.
 */
export interface IIconDef {
  paths: readonly string[];
  /** Relleno en lugar de trazo (glifos de marca). */
  fill?: boolean;
}

const circle = (cx: number, cy: number, r: number): string => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0`;
const ring = circle(12, 12, 10);

export const ICONS = {
  // Interfaz
  close: { paths: ['M18 6 6 18', 'M6 6l12 12'] },
  play: { paths: ['M7 4v16l13-8z'], fill: true },
  pause: { paths: ['M7 4h3v16H7z', 'M14 4h3v16h-3z'], fill: true },
  upload: { paths: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M17 8l-5-5-5 5', 'M12 3v12'] },
  retry: { paths: ['M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8', 'M21 3v5h-5'] },
  edit: { paths: ['M12 20h9', 'M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z'] },
  trash: { paths: ['M3 6h18', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6', 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'] },
  link: { paths: ['M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71', 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'] },
  external: { paths: ['M15 3h6v6', 'M10 14 21 3', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'] },
  search: { paths: [circle(11, 11, 8), 'M21 21l-4.3-4.3'] },
  bell: { paths: ['M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9', 'M10.3 21a1.94 1.94 0 0 0 3.4 0'] },
  sun: { paths: [circle(12, 12, 4), 'M12 2v2', 'M12 20v2', 'M4.93 4.93l1.41 1.41', 'M17.66 17.66l1.41 1.41', 'M2 12h2', 'M20 12h2', 'M6.34 17.66l-1.41 1.41', 'M19.07 4.93l-1.41 1.41'] },
  moon: { paths: ['M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z'] },
  film: { paths: ['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M7 3v18', 'M17 3v18', 'M3 7.5h4', 'M3 12h18', 'M3 16.5h4', 'M17 7.5h4', 'M17 16.5h4'] },
  broadcast: { paths: ['M4.9 19.1C1 15.2 1 8.8 4.9 4.9', 'M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5', circle(12, 12, 2), 'M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5', 'M19.1 4.9C23 8.8 23 15.1 19.1 19'] },
  sliders: { paths: ['M4 21v-7', 'M4 10V3', 'M12 21v-9', 'M12 8V3', 'M20 21v-5', 'M20 12V3', 'M1 14h6', 'M9 8h6', 'M17 16h6'] },
  key: { paths: [circle(7.5, 15.5, 5.5), 'M11.4 11.6 21 2', 'M15.5 7.5l3 3L22 7l-3-3'] },
  folder: { paths: ['M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z'] },
  star: { paths: ['M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z'], fill: true },
  book: { paths: ['M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z', 'M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z'] },
  help: { paths: [ring, 'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3', 'M12 17h.01'] },
  info: { paths: [ring, 'M12 16v-4', 'M12 8h.01'] },
  success: { paths: [ring, 'M9 12l2 2 4-4'] },
  error: { paths: [ring, 'M15 9l-6 6', 'M9 9l6 6'] },
  warning: { paths: ['M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z', 'M12 9v4', 'M12 17h.01'] },
  clock: { paths: [ring, 'M12 6v6l4 2'] },
  hourglass: { paths: ['M5 22h14', 'M5 2h14', 'M17 22v-4.17a2 2 0 0 0-.59-1.42L12 12l-4.41 4.41A2 2 0 0 0 7 17.83V22', 'M7 2v4.17a2 2 0 0 0 .59 1.42L12 12l4.41-4.41A2 2 0 0 0 17 6.17V2'] },
  check: { paths: ['M20 6 9 17l-5-5'] },
  plus: { paths: ['M12 5v14', 'M5 12h14'] },
  chevronRight: { paths: ['M9 18l6-6-6-6'] },
  chevronDown: { paths: ['M6 9l6 6 6-6'] },
  arrowLeft: { paths: ['M19 12H5', 'M12 19l-7-7 7-7'] },
  arrowRight: { paths: ['M5 12h14', 'M12 5l7 7-7 7'] },
  logout: { paths: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 17l5-5-5-5', 'M21 12H9'] },
  database: { paths: ['M12 8c4.97 0 9-1.34 9-3s-4.03-3-9-3-9 1.34-9 3 4.03 3 9 3z', 'M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5', 'M3 12c0 1.66 4 3 9 3s9-1.34 9-3'] },
  dot: { paths: [circle(12, 12, 5)], fill: true },
  eye: { paths: ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z', circle(12, 12, 3)] },
  calendar: { paths: ['M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'M16 2v4', 'M8 2v4', 'M3 10h18'] },
  chart: { paths: ['M3 3v18h18', 'M7 16v-5', 'M12 16V8', 'M17 16v-8'] },
  grid: { paths: ['M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M14 14h7v7h-7z', 'M3 14h7v7H3z'] },
  list: { paths: ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01'] },
  tag: { paths: ['M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z', 'M7 7h.01'] },
  download: { paths: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3'] },
  image: { paths: ['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', circle(8.5, 8.5, 1.5), 'M21 15l-5-5L5 21'] },
  camera: { paths: ['M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z', circle(12, 13, 4)] },
  template: { paths: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6', 'M8 13h8', 'M8 17h5'] },
  save: { paths: ['M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z', 'M17 21v-8H7v8', 'M7 3v5h8'] },
  heart: { paths: ['M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z'] },
  message: { paths: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'] },
  home: { paths: ['M3 10.5 12 3l9 7.5', 'M5 9.5V21h5v-6h4v6h5V9.5'] },
  inbox: { paths: ['M22 12h-6l-2 3h-4l-2-3H2', 'M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z'] },
  send: { paths: ['M22 2 11 13', 'M22 2l-7 20-4-9-9-4 20-7z'] },
  note: { paths: ['M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z', 'M14 3v6h6', 'M8 13h8', 'M8 17h5'] },
  paperclip: { paths: ['M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48'] },
  lock: { paths: ['M5 11h14v10H5z', 'M8 11V7a4 4 0 0 1 8 0v4'] },
  user: { paths: [circle(12, 8, 4), 'M4 21a8 8 0 0 1 16 0'] },
  zap: { paths: ['M13 2 3 14h9l-1 8 10-12h-9l1-8z'] },
  checkSquare: { paths: ['M9 11l3 3L22 4', 'M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11'] },
  spinner: { paths: ['M21 12a9 9 0 1 1-6.22-8.56'] },
  fileText: { paths: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6', 'M16 13H8', 'M16 17H8', 'M10 9H8'] },
  images: { paths: ['M8 2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z', 'M22 13l-4-4-8 8', 'M2 7v13a2 2 0 0 0 2 2h13'] },
  text: { paths: ['M4 7V4h16v3', 'M9 20h6', 'M12 4v16'] },
  grip: { paths: [circle(9, 6, 1), circle(15, 6, 1), circle(9, 12, 1), circle(15, 12, 1), circle(9, 18, 1), circle(15, 18, 1)] },

  // Plataformas
  youtube: { paths: ['M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8zM9.6 15.6V8.4l6.2 3.6z'], fill: true },
  facebook: { paths: ['M14 8h3V4h-3c-2.76 0-5 2.24-5 5v2H7v4h2v9h4v-9h3l1-4h-4V9c0-.55.45-1 1-1z'], fill: true },
  instagram: { paths: ['M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5z', circle(12, 12, 4), 'M17.5 6.5h.01'] },
  telegram: { paths: ['M21.9 4.3 18.7 19.4c-.2 1-.9 1.3-1.8.8l-4.9-3.6-2.4 2.3c-.3.3-.5.5-1 .5l.4-5 9.1-8.2c.4-.4-.1-.6-.6-.2L6.3 13.1 1.5 11.6c-1-.3-1-1 .2-1.5L20.6 2.8c.9-.3 1.6.2 1.3 1.5z'], fill: true },
  tiktok: { paths: ['M16.6 5.82A4.28 4.28 0 0 1 15.54 3h-3.09v12.4a2.59 2.59 0 0 1-2.59 2.5c-1.42 0-2.6-1.16-2.6-2.6 0-1.72 1.66-3.01 3.37-2.48V9.66c-3.45-.46-6.47 2.22-6.47 5.64 0 3.33 2.76 5.7 5.69 5.7 3.14 0 5.69-2.55 5.69-5.7V9.01a7.35 7.35 0 0 0 4.3 1.38V7.3s-1.88.09-3.24-1.48z'], fill: true },
  linkedin: { paths: ['M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56z'], fill: true },
  teams: { paths: ['M14.5 6.5a2.5 2.5 0 1 1 5 0 2.5 2.5 0 0 1-5 0z', 'M15 9.5h6a1 1 0 0 1 1 1v5a3.5 3.5 0 0 1-5.6 2.8', 'M2 6h11a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z', 'M4.5 9.5h6', 'M7.5 9.5v6.5'] },
  whatsapp: { paths: ['M3 21l1.65-3.8a9 9 0 1 1 3.4 2.9L3 21', 'M9 10a.5.5 0 0 0 1 0V9a.5.5 0 0 0-1 0v1a5 5 0 0 0 5 5h1a.5.5 0 0 0 0-1h-1a.5.5 0 0 0 0 1'] }
} as const satisfies Record<string, IIconDef>;

export type IconName = keyof typeof ICONS;
