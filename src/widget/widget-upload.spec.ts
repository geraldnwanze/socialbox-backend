import { cleanProfile } from './widget.service';
import { cleanFileName, isAllowedWidgetFile } from './widget-upload';

describe('isAllowedWidgetFile', () => {
  it('accepts common images and documents', () => {
    expect(isAllowedWidgetFile('image/png', 'a.PNG')).toBe(true);
    expect(isAllowedWidgetFile('application/pdf', 'invoice.pdf')).toBe(true);
  });

  it('rejects anything script- or program-capable', () => {
    expect(isAllowedWidgetFile('image/svg+xml', 'a.svg')).toBe(false);
    expect(isAllowedWidgetFile('text/html', 'a.html')).toBe(false);
    expect(isAllowedWidgetFile('application/x-msdownload', 'a.exe')).toBe(
      false,
    );
    expect(isAllowedWidgetFile('application/zip', 'a.zip')).toBe(false);
  });

  it('needs the type AND the extension to agree with the list', () => {
    expect(isAllowedWidgetFile('image/png', 'evil.html')).toBe(false);
    expect(isAllowedWidgetFile('text/html', 'pic.png')).toBe(false);
    expect(isAllowedWidgetFile('image/png', 'noextension')).toBe(false);
  });
});

describe('cleanFileName', () => {
  it('drops paths and control characters', () => {
    expect(cleanFileName('../../etc/passwd')).toBe('passwd');
    expect(cleanFileName('C:\\x\\report.pdf')).toBe('report.pdf');
    expect(cleanFileName('a\r\nb.png')).toBe('ab.png');
    expect(cleanFileName('')).toBe('file');
  });
});

describe('cleanProfile', () => {
  it('keeps a trimmed name and a valid lower-cased email', () => {
    expect(cleanProfile('  Ann Lee ', 'Ann@Example.COM ')).toEqual({
      name: 'Ann Lee',
      email: 'ann@example.com',
    });
  });

  it('strips markup characters and drops invalid emails', () => {
    expect(cleanProfile('<b>Ann</b>', 'not-an-email')).toEqual({
      name: 'bAnn/b',
    });
    expect(cleanProfile(undefined, undefined)).toBeUndefined();
    expect(cleanProfile('x'.repeat(200))?.name).toHaveLength(80);
  });
});
