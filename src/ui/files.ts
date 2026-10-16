/**
 * Сохранение файла для пользователя. На iPhone надёжнее всего системное меню «Поделиться»
 * (оттуда можно сохранить в «Файлы»); если оно недоступно — обычное скачивание.
 */
export async function saveTextFile(fileName: string, text: string, mime: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([text], fileName, { type: mime });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (typeof nav.share === 'function' && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: fileName });
      return 'shared';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
      // иначе — пробуем обычное скачивание
    }
  }
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}

export class FileReadError extends Error {}

/** Читает выбранный файл как текст, не загружая слишком большие файлы. */
export async function readTextFile(file: File, maxBytes: number): Promise<string> {
  if (file.size === 0) throw new FileReadError('Файл пустой.');
  if (file.size > maxBytes) throw new FileReadError(`Файл слишком большой (максимум ${Math.round(maxBytes / 1024 / 1024)} МБ).`);
  try {
    return await file.text();
  } catch {
    throw new FileReadError('Не удалось прочитать файл. Попробуйте выбрать его ещё раз.');
  }
}
