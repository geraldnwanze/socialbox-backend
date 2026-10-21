import { redactSensitive } from './ai.redact';

describe('redactSensitive', () => {
  it('removes credentials a customer pasted by mistake', () => {
    const tg = '1234567890:AAFakeFakeFakeFakeFakeFakeFakeFake12';
    expect(redactSensitive(`my bot token is ${tg} please help`)).toBe(
      'my bot token is [secret removed] please help',
    );
    expect(
      redactSensitive('key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789'),
    ).toBe('key [secret removed]');
    expect(
      redactSensitive('Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456'),
    ).toBe('Authorization: [secret removed]');
    expect(
      redactSensitive(
        'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop',
      ),
    ).toBe('jwt [secret removed]');
    expect(redactSensitive('AKIAIOSFODNN7EXAMPLE')).toBe('[secret removed]');
    expect(
      redactSensitive(
        '-----BEGIN PRIVATE KEY-----\nMIIEvQ\n-----END PRIVATE KEY-----',
      ),
    ).toBe('[secret removed]');
  });

  it('removes real card numbers (checksum-valid) in common formats', () => {
    expect(redactSensitive('card 4111 1111 1111 1111 exp 12/27')).toBe(
      'card [card number removed] exp 12/27',
    );
    expect(redactSensitive('4242-4242-4242-4242')).toBe(
      '[card number removed]',
    );
    expect(redactSensitive('5555555555554444')).toBe('[card number removed]');
  });

  it('leaves ordinary numbers alone', () => {
    const ok =
      'Order 1234567890123 shipped, call +234 803 123 4567 or ref 4111 1111 1111 1112, version 8.2.1';
    expect(redactSensitive(ok)).toBe(ok); // invalid checksum, phone and order numbers survive
    expect(redactSensitive('Hi, where is my order 42?')).toBe(
      'Hi, where is my order 42?',
    );
  });
});
