export interface IVideoProbe {
  durationSec?: number;
  width?: number;
  height?: number;
  poster?: Blob;
}

const POSTER_WIDTH = 640;

/**
 * Lee duración y tamaño del video en el navegador y captura un fotograma como miniatura, antes de
 * subirlo. El servidor no necesita ffmpeg. Si el navegador no puede decodificar el formato (p. ej.
 * algunos .mkv/.avi) se devuelve lo que se haya podido leer y la subida sigue igual.
 */
export async function probeVideo(file: File): Promise<IVideoProbe> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.muted = true;
  video.playsInline = true;
  video.src = url;

  const result: IVideoProbe = {};
  try {
    await waitFor(video, 'loadedmetadata', 15000);
    if (isFinite(video.duration)) result.durationSec = Math.round(video.duration * 1000) / 1000;
    if (video.videoWidth > 0) result.width = video.videoWidth;
    if (video.videoHeight > 0) result.height = video.videoHeight;

    video.currentTime = Math.min(1, (result.durationSec ?? 0) / 10);
    await waitFor(video, 'seeked', 10000);
    result.poster = (await captureFrame(video, POSTER_WIDTH, 0.82)) ?? undefined;
  } catch {
    // Formato no decodificable por el navegador: se sube sin miniatura.
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
  return result;
}

function waitFor(video: HTMLVideoElement, event: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => cleanup(new Error('timeout')), timeoutMs);
    const onEvent = () => cleanup();
    const onError = () => cleanup(new Error('error'));
    const cleanup = (error?: Error) => {
      clearTimeout(timer);
      video.removeEventListener(event, onEvent);
      video.removeEventListener('error', onError);
      error ? reject(error) : resolve();
    };
    video.addEventListener(event, onEvent, { once: true });
    video.addEventListener('error', onError, { once: true });
  });
}

/**
 * Fotograma actual del <video> como JPEG, como mucho `maxWidth` px de ancho. null si el navegador no
 * tiene imagen (aún no cargó o el formato no se decodifica).
 */
export function captureFrame(video: HTMLVideoElement, maxWidth: number, quality: number): Promise<Blob | null> {
  return drawJpeg(video, video.videoWidth, video.videoHeight, maxWidth, quality);
}

export interface IImageProbe {
  width?: number;
  height?: number;
  /** Miniatura JPEG (como mucho POSTER_WIDTH de ancho) para no descargar la imagen entera en las listas. */
  poster?: Blob;
}

/** Lee el tamaño de una imagen en el navegador y genera su miniatura JPEG. Si no se puede, la subida sigue igual. */
export async function probeImage(file: File): Promise<IImageProbe> {
  const url = URL.createObjectURL(file);
  const result: IImageProbe = {};
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (image.naturalWidth > 0) result.width = image.naturalWidth;
    if (image.naturalHeight > 0) result.height = image.naturalHeight;
    result.poster = (await drawJpeg(image, image.naturalWidth, image.naturalHeight, POSTER_WIDTH, 0.82)) ?? undefined;
  } catch {
    // Formato que el navegador no decodifica: se sube sin miniatura.
  } finally {
    URL.revokeObjectURL(url);
  }
  return result;
}

function drawJpeg(source: CanvasImageSource, width: number, height: number, maxWidth: number, quality: number): Promise<Blob | null> {
  if (!width || !height) return Promise.resolve(null);
  const scale = Math.min(1, maxWidth / width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext('2d');
  if (!context) return Promise.resolve(null);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise(resolve => canvas.toBlob(blob => resolve(blob), 'image/jpeg', quality));
}
