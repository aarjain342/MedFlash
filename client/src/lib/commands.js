// Matching for the command palette (Ctrl/Cmd+K). A command is
// { id, group, label, keywords?, run }. A query matches when every space-separated word
// appears somewhere in the label, group or keywords (case-insensitive), so "study renal"
// finds "Renal physiology" under Study. Better matches sort first, ties keep their original
// order, which is how the caller lists them.
export function filterCommands(commands, query) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return commands;

  const scored = [];
  for (const command of commands) {
    const label = command.label.toLowerCase();
    const haystack = `${label} ${command.group.toLowerCase()} ${(command.keywords || '').toLowerCase()}`;
    if (!words.every((word) => haystack.includes(word))) continue;

    let score = 3;
    if (label.startsWith(words[0])) score = 0;
    else if (label.split(/\s+/).some((token) => token.startsWith(words[0]))) score = 1;
    else if (label.includes(words[0])) score = 2;
    scored.push({ command, score, order: scored.length });
  }
  return scored.sort((a, b) => a.score - b.score || a.order - b.order).map((s) => s.command);
}

// Arrow-key movement through a list of `length` items, wrapping at both ends.
export function moveIndex(index, delta, length) {
  if (length <= 0) return 0;
  return (((index + delta) % length) + length) % length;
}
