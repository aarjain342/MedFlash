const MAX_HISTORY_MESSAGES = 6; // last 3 turns — enough context without ballooning the prompt
const MAX_MESSAGE_CHARS = 4000;

function asText(value, max = MAX_MESSAGE_CHARS) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

// Client-supplied history, so every entry is coerced/filtered rather than trusted — a
// malformed role or content type here would otherwise flow straight into the prompt string.
export function sanitizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-MAX_HISTORY_MESSAGES)
    .map((m) => ({ role: m.role, content: asText(m.content) }));
}

export function buildChatPrompt(message, history) {
  const transcript = history
    .map((m) => `${m.role === 'user' ? 'Student' : 'Assistant'}: ${m.content}`)
    .join('\n');

  return `You are a knowledgeable, friendly medical education assistant helping a medical student study. Answer clearly, accurately, and at a level appropriate for a med student. If a question sounds like it's about a specific real patient (diagnosis, treatment, medication dosing for an actual case), remind them briefly that this is for educational purposes only and not a substitute for professional medical advice, then still give a helpful educational answer.

Keep answers focused and well-organized — short paragraphs or a brief numbered/bulleted breakdown where it helps. Plain text only, no markdown formatting (no **, no #).
${transcript ? `\nConversation so far:\n${transcript}\n` : ''}
Student: ${asText(message)}
Assistant:`;
}
