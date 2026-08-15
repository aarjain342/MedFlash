import initSqlJs from 'sql.js';
import { Model, Deck, Package } from './genanki.js';

let sqlJsPromise;
function getSqlJs() {
  if (!sqlJsPromise) {
    sqlJsPromise = initSqlJs({ locateFile: () => '/sql-wasm.wasm' });
  }
  return sqlJsPromise;
}

function dataUrlToUint8Array(dataUrl) {
  const base64 = dataUrl.split(',')[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function slug(str) {
  return (str || '').toString().trim().replace(/\s+/g, '_').replace(/[^\w-]/g, '') || 'deck';
}

function escapeHtml(str) {
  return (str || '')
    .toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function answerToHtml(answer) {
  return escapeHtml(answer).replace(/\n/g, '<br>');
}

function tableToHtml(table) {
  if (!table || !table.headers || !table.rows) return '';
  const headerRow = table.headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('');
  const bodyRows = table.rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
    .join('');
  return `<table class="ac-table"><thead><tr>${headerRow}</tr></thead><tbody>${bodyRows}</tbody></table>`;
}

export async function exportDeckToAnki(deck) {
  const SQL = await getSqlJs();
  const db = new SQL.Database();

  const model = new Model({
    name: 'MedFlash',
    id: '1700000000002',
    flds: [{ name: 'Front' }, { name: 'Back' }, { name: 'Table' }, { name: 'Mnemonic' }, { name: 'Image' }],
    req: [[0, 'all', [0]]],
    tmpls: [
      {
        name: 'Card 1',
        qfmt: '{{Front}}',
        afmt: `{{FrontSide}}<hr id="answer"><div class="answer">{{Back}}</div>
{{#Table}}{{Table}}{{/Table}}
{{#Mnemonic}}<div class="mnemonic">💡 {{Mnemonic}}</div>{{/Mnemonic}}
{{#Image}}<div class="slide">{{Image}}</div>{{/Image}}`,
      },
    ],
    css: `
.card {
  font-family: -apple-system, Segoe UI, Arial, sans-serif;
  font-size: 18px;
  text-align: center;
  color: #1a1f2e;
  background-color: #ffffff;
}
.answer { line-height: 1.6; text-align: center; }
.ac-table { border-collapse: collapse; margin: 14px auto; font-size: 15px; text-align: left; }
.ac-table th, .ac-table td { border: 1px solid #d5d9e3; padding: 6px 10px; color: #1a1f2e; background: #ffffff; }
.ac-table th { background: #eef0f6; font-weight: 700; }
.mnemonic { margin: 16px auto 0; max-width: 480px; font-size: 15px; font-style: italic; color: #444; padding: 10px 14px; background: #fef3c7; border-radius: 8px; }
.slide { margin-top: 12px; }
.slide img { max-width: 100%; border-radius: 8px; }

/* Anki desktop night mode */
.night_mode.card, .card.night_mode {
  color: #e8e8f0;
  background-color: #1e1e2e;
}
.night_mode .ac-table th, .card.night_mode .ac-table th { background: #33344d; color: #e8e8f0; }
.night_mode .ac-table td, .card.night_mode .ac-table td { background: #262638; color: #e8e8f0; border-color: #46475f; }
.night_mode .mnemonic, .card.night_mode .mnemonic { background: #4a3f1a; color: #fbe9b0; }

/* AnkiDroid / AnkiMobile follow the system theme */
@media (prefers-color-scheme: dark) {
  .card { color: #e8e8f0; background-color: #1e1e2e; }
  .ac-table th { background: #33344d; color: #e8e8f0; }
  .ac-table td { background: #262638; color: #e8e8f0; border-color: #46475f; }
  .mnemonic { background: #4a3f1a; color: #fbe9b0; }
}
`,
  });

  const ankiDeck = new Deck(Date.now(), deck.name);

  const pkg = new Package();
  pkg.setSqlJs(db);

  const mediaByPage = new Map();

  for (const card of deck.cards) {
    let imageTag = '';
    if (card.image) {
      const key = card.page ?? card.image;
      let filename = mediaByPage.get(key);
      if (!filename) {
        filename = `slide-${key}.png`;
        pkg.addMedia(dataUrlToUint8Array(card.image), filename);
        mediaByPage.set(key, filename);
      }
      imageTag = `<img src="${filename}">`;
    }

    const tags = card.topic ? [slug(card.topic)] : [];
    const note = model.note(
      [card.question, answerToHtml(card.answer), tableToHtml(card.table), card.mnemonic || '', imageTag],
      tags
    );
    ankiDeck.addNote(note);
  }

  pkg.addDeck(ankiDeck);
  pkg.writeToFile(`${slug(deck.name)}.apkg`);
}
