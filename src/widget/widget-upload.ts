export const MAX_WIDGET_FILE_BYTES = 5 * 1024 * 1024;

// Visitors are anonymous, so this is deliberately narrower than what agents may send: no SVG
// (script-capable), no HTML, no executables, no archives.
const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

const ALLOWED_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'pdf',
  'txt',
  'csv',
  'doc',
  'docx',
  'xls',
  'xlsx',
]);

/** Both the reported type and the file extension must be on the list: either alone is spoofable. */
export function isAllowedWidgetFile(
  mimeType: string,
  fileName: string,
): boolean {
  const ext = fileName.includes('.')
    ? fileName.split('.').pop()!.toLowerCase()
    : '';
  return (
    ALLOWED_TYPES.has(mimeType.toLowerCase()) && ALLOWED_EXTENSIONS.has(ext)
  );
}

/** Strips path parts and control characters; the name is only ever displayed or sent as a header value. */
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  // eslint-disable-next-line no-control-regex
  return (
    base
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .trim()
      .slice(0, 120) || 'file'
  );
}
