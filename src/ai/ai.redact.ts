/**
 * Removes things that should never be sent to a third-party model: credentials a customer pasted by
 * mistake (bot tokens, API keys, JWTs, private keys) and payment card numbers. Deliberately
 * conservative about what counts as a secret so ordinary order numbers and phone numbers survive.
 */

const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWT
  /\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/g, // Telegram bot token
  /\bsk-[A-Za-z0-9_-]{20,}\b/g, // API keys (Anthropic, OpenAI, Stripe secret keys…)
  /\b(?:pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g, // Stripe-style keys
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, // GitHub tokens
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, // Slack tokens
  /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/gi,
  /\b[a-f0-9]{40,}\b/gi, // long hex secrets / hashes
];

function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

export function redactSensitive(text: string): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS)
    out = out.replace(pattern, '[secret removed]');
  // 13-19 digits, optionally grouped by spaces or dashes, that pass the card checksum.
  out = out.replace(/\b(?:\d[ -]?){12,18}\d\b/g, (match) => {
    const digits = match.replace(/[ -]/g, '');
    return digits.length >= 13 && digits.length <= 19 && luhnValid(digits)
      ? '[card number removed]'
      : match;
  });
  return out;
}
