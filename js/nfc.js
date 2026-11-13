// NFC-мітки через Web NFC (лише Chrome на Android): на мітку пишеться посилання на річ чи місце,
// а відкритий застосунок читає мітки сам. Без застосунку посилання з мітки відкриває телефон.

/** Web NFC є лише в Chrome на Android і лише на https. */
export const supported = () => 'NDEFReader' in window && window.isSecureContext;

let listening = null;
let onTag = null;

/** Дозвіл на NFC уже дано — тоді читати можна без натискання кнопки. */
export async function granted() {
  try { return (await navigator.permissions.query({ name: 'nfc' })).state === 'granted'; } catch { return false; }
}

/** Слухати мітки, поки застосунок на екрані; handler отримує адреси з мітки й її серійний номер. */
export async function listen(handler) {
  onTag = handler;
  if (listening || !supported()) return;
  const ctrl = new AbortController();
  listening = ctrl;
  const reader = new NDEFReader();
  reader.addEventListener('reading', (e) => {
    const text = new TextDecoder();
    const urls = e.message.records.filter((r) => ['url', 'absolute-url'].includes(r.recordType) && r.data).map((r) => text.decode(r.data));
    onTag?.(urls, e.serialNumber);
  }, { signal: ctrl.signal });
  try {
    await reader.scan({ signal: ctrl.signal });
  } catch (err) {
    if (listening === ctrl) listening = null;
    throw err;
  }
}

export function stop() {
  listening?.abort();
  listening = null;
}

export const active = () => Boolean(listening);

/** Записати посилання на мітку: чекає дотику, сигнал — скасувати. Читання на час запису зупиняється. */
export async function writeUrl(url, signal) {
  const wasListening = active();
  stop();
  try {
    await new NDEFReader().write({ records: [{ recordType: 'url', data: url }] }, { signal });
  } finally {
    if (wasListening && onTag) listen(onTag).catch(() => {});
  }
}
