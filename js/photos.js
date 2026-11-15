// Фото снастей і місць: стиснення на пристрої й мініатюра для списку (з shooting-log, без студії й редактора).
// Мініатюра (~10 КБ) їде в запис photos і синхронізується в JSON, повне фото — окремим файлом (blobs, Google Диск).
import { t } from './i18n.js';

const FULL = 1000;
const THUMB = 240;

/** Декодування з урахуванням EXIF-орієнтації — інакше фото з телефона лягають боком. */
async function decode(file) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* нижче — запасний шлях */ }
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function draw(src, max) {
  const k = Math.min(1, max / Math.max(src.width, src.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(src.width * k));
  canvas.height = Math.max(1, Math.round(src.height * k));
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function jpeg(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error(t('Не вдалося обробити фото')))), 'image/jpeg', quality);
  });
}

/** Файл з галереї чи камери → { blob, thumb }. */
export async function prepare(file) {
  let src;
  try {
    src = await decode(file);
  } catch {
    throw new Error(t('Формат фото не підтримується'));
  }
  const full = draw(src, FULL);
  src.close?.();
  return { blob: await jpeg(full, 0.82), thumb: draw(full, THUMB).toDataURL('image/jpeg', 0.7) };
}

// Лист карти глибин: цифри промірів дрібні — тримаємо до 3200 пікселів по довшій стороні,
// але не більше 12 Мп (полотно iOS ламається на ~16,7 Мп) і не більше ~4,5 МБ (одним запитом на Диск — до 5 МБ).
const SHEET = 3200;
const SHEET_AREA = 12e6;
const SHEET_BYTES = 4.5e6;

/** Файл листа → { blob, thumb, w, h } (w, h — розмір збереженої картинки, у ній ставляться точки прив'язки). */
export async function prepareSheet(file) {
  let src;
  try {
    src = await decode(file);
  } catch {
    throw new Error(t('Формат картинки не підтримується'));
  }
  const side = Math.max(src.width, src.height);
  const k = Math.min(1, SHEET / side, Math.sqrt(SHEET_AREA / (src.width * src.height)));
  const full = draw(src, Math.round(side * k));
  src.close?.();
  let blob = await jpeg(full, 0.85);
  if (blob.size > SHEET_BYTES) blob = await jpeg(full, 0.7);
  return { blob, thumb: draw(full, THUMB).toDataURL('image/jpeg', 0.7), w: full.width, h: full.height };
}
