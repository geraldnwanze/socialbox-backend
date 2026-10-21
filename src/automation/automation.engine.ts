import { isWithinHours } from '../channels/adapters/live-chat/live-chat-hours';
import { AutomationCondition, MatchContext } from './automation.types';

/** Case-insensitive "contains" on the message text (so "refund" also catches "refunds"). */
export function containsAnyKeyword(text: string, keywords: string[]): boolean {
  const haystack = text.toLowerCase();
  return keywords.some((k) => k.trim() && haystack.includes(k.toLowerCase()));
}

export function conditionMatches(
  condition: AutomationCondition,
  ctx: MatchContext,
): boolean {
  switch (condition.type) {
    case 'CHANNEL':
      return condition.channels.includes(ctx.channelType);
    case 'KEYWORDS':
      return containsAnyKeyword(ctx.text, condition.keywords);
    case 'FIRST_MESSAGE':
      return ctx.isNewConversation;
    case 'UNASSIGNED':
      return !ctx.assigned;
    case 'OUTSIDE_HOURS':
      return !isWithinHours({ ...condition.hours, enabled: true }, ctx.now);
  }
}

/** A rule with no conditions matches every message — which is how "always do X" rules work. */
export function rulesMatch(
  conditions: AutomationCondition[],
  ctx: MatchContext,
): boolean {
  return conditions.every((c) => conditionMatches(c, ctx));
}

/**
 * Least-busy assignment: whoever has the fewest open conversations; ties are broken randomly so
 * the same person doesn't always get the next one when everyone is equally loaded.
 */
export function pickLeastBusy(
  candidates: string[],
  openCounts: Map<string, number>,
  random: () => number = Math.random,
): string | null {
  if (candidates.length === 0) return null;
  const load = (id: string) => openCounts.get(id) ?? 0;
  const min = Math.min(...candidates.map(load));
  const tied = candidates.filter((id) => load(id) === min);
  return tied[Math.floor(random() * tied.length)];
}

export function expandPlaceholders(
  text: string,
  context: { customerName?: string | null },
): string {
  const name = context.customerName?.trim();
  const generated = !name || /^(website visitor|unknown)\b/i.test(name);
  const first = generated ? 'there' : name.split(/\s+/)[0];
  return text.replace(/\{\{\s*customer_name\s*\}\}/gi, first);
}
