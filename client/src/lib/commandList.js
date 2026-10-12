// Builds the command palette's list from what the dashboard currently has. Study/Quiz commands
// only appear for decks whose cards have finished loading, because the study screens need them
// (the deck lists disable the same buttons while a deck is still "Loading…").
export function buildCommands({ decks = [], anatomyDecks = [], guestMode = false, actions }) {
  const commands = [
    { id: 'go-home', group: 'Go to', label: 'Home', keywords: 'today dashboard', run: () => actions.navigate('home') },
    { id: 'go-decks', group: 'Go to', label: 'Decks', keywords: 'upload create generate', run: () => actions.navigate('decks') },
    { id: 'go-flashcards', group: 'Go to', label: 'Flashcards', keywords: 'browse cards', run: () => actions.navigate('flashcards') },
    { id: 'go-questions', group: 'Go to', label: 'Questions', keywords: 'usmle quiz', run: () => actions.navigate('questions') },
    { id: 'go-anatomy', group: 'Go to', label: 'Anatomy quiz', keywords: 'diagram labels bones', run: () => actions.navigate('anatomy') },
    { id: 'go-settings', group: 'Go to', label: 'Settings', keywords: 'plan billing account appearance', run: () => actions.navigate('settings') },
  ];

  for (const deck of decks) {
    if (!deck.cards || deck.cards.length === 0) continue;
    commands.push({ id: `study-${deck.id}`, group: 'Study', label: deck.name, keywords: 'flashcards review', run: () => actions.study(deck) });
    commands.push({ id: `quiz-${deck.id}`, group: 'Quiz', label: deck.name, keywords: 'usmle questions', run: () => actions.quiz(deck) });
  }

  for (const deck of anatomyDecks) {
    if (!deck.pages || deck.pages.length === 0) continue;
    commands.push({ id: `anatomy-${deck.id}`, group: 'Anatomy', label: deck.name, keywords: 'quiz diagram labels', run: () => actions.studyAnatomy(deck) });
  }

  commands.push(
    { id: 'theme-system', group: 'Appearance', label: 'Theme: match system', keywords: 'dark light', run: () => actions.setTheme('system') },
    { id: 'theme-light', group: 'Appearance', label: 'Theme: light', keywords: 'dark light', run: () => actions.setTheme('light') },
    { id: 'theme-dark', group: 'Appearance', label: 'Theme: dark', keywords: 'dark light night', run: () => actions.setTheme('dark') }
  );

  if (!guestMode) {
    commands.push({ id: 'sign-out', group: 'Account', label: 'Sign out', keywords: 'log out', run: () => actions.signOut() });
  }
  return commands;
}
