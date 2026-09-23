import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(process.argv[2] || '.');
const source = fs.readFileSync(path.join(repo, 'integrations/rmmz/WonderLangAccountCloudSync.js'), 'utf8');
const keys = ['CloudAccount.Profile.CopyLocalBody', 'CloudAccount.Startup.MismatchSafeBody', 'CloudAccount.Error.DuplicateProfileName', 'CloudAccount.Action.SaveLocalToExisting', 'CloudAccount.Profile.ReplaceWithLocalBody'];
const first = JSON.parse(fs.readFileSync(path.join(repo, 'integrations/rmmz/profile-recovery-menu-translations.json'), 'utf8')).translations;
const second = JSON.parse(fs.readFileSync(path.join(repo, 'integrations/rmmz/existing-profile-menu-translations.json'), 'utf8')).translations;
const backup = path.join(repo, 'backups', `profile-recovery-${Date.now()}`);
function write(file, before, after) {
  if (before === after) return;
  fs.mkdirSync(backup, { recursive: true });
  fs.writeFileSync(path.join(backup, path.basename(file)), before);
  fs.writeFileSync(file, after);
  console.log(`Updated ${file}`);
}
function region(text, name) {
  const match = new RegExp(`^  (?:async )?function ${name}\\(`, 'm').exec(text);
  if (!match) throw Error(`Missing function ${name}`);
  const start = match.index;
  const next = /^  (?:async )?function /m.exec(text.slice(start + 3));
  if (!next) throw Error(`Missing end of ${name}`);
  return [start, start + 3 + next.index];
}
const plugin = path.join(root, 'js/plugins/WonderLangAccountCloudSync.js');
const before = fs.readFileSync(plugin, 'utf8');
const newline = before.includes('\r\n') ? '\r\n' : '\n';
let updated = before.replace(/\r\n/g, '\n');
for (const name of ['playerErrorMessage', 'openCloudSavesPanel', 'showUnlabelledWorkspacePrompt', 'showWorkspaceMismatchPrompt']) {
  const [a,b] = region(updated,name); const [c,d] = region(source,name);
  updated = updated.slice(0,a) + source.slice(c,d) + updated.slice(b);
}
const a = updated.indexOf('  function canSaveLocalAsNewProfile');
const b = updated.indexOf('  async function openProfileBackups', a);
const c = source.indexOf('  function canSaveLocalAsNewProfile');
const d = source.indexOf('  async function openProfileBackups', c);
if ([a,b,c,d].some(n => n < 0)) throw Error('Recovery integration anchors missing');
updated = updated.slice(0,a) + source.slice(c,d) + updated.slice(b);
updated = updated.replace('.wl-account-actions{display:flex;', '.wl-account-actions{max-height:45vh;display:flex;')
  .replace('<div class="wl-account-actions"></div>', '<div class="wl-account-actions wl-account-scroll"></div>');
// Validate the entire translation update before writing either file.
const menu = path.join(root, 'texts/menu.json');
const menuBefore = fs.readFileSync(menu, 'utf8');
const menuNewline = menuBefore.includes('\r\n') ? '\r\n' : '\n';
const table = JSON.parse(menuBefore.replace(/^\uFEFF/, ''));
let menuAfter = menuBefore;
if (Object.keys(table.translations).sort().join() !== Object.keys(first).sort().join()) throw Error('Language inventory differs');
for (const [locale, section] of Object.entries(table.translations)) {
  const values = [...first[locale], ...second[locale]];
  const missing = keys.filter((key,i) => {
    if (key in section && section[key] !== values[i]) throw Error(`Unexpected existing text: ${locale}/${key}`);
    return !(key in section);
  });
  if (!missing.length) continue;
  const anchor = `      "CloudAccount.Action.SaveLocalAsNew": ${JSON.stringify(section['CloudAccount.Action.SaveLocalAsNew'])},`;
  const start = menuAfter.indexOf(`    "${locale}": {`);
  const position = menuAfter.indexOf(anchor, start);
  if (start < 0 || position < 0) throw Error(`Missing translation anchor: ${locale}`);
  const at = position + anchor.length;
  menuAfter = menuAfter.slice(0,at) + missing.map(key => `${menuNewline}      ${JSON.stringify(key)}: ${JSON.stringify(values[keys.indexOf(key)])},`).join('') + menuAfter.slice(at);
}
JSON.parse(menuAfter.replace(/^\uFEFF/, ''));
write(plugin,before,updated.replace(/\n/g,newline));
write(menu,menuBefore,menuAfter);
console.log('Profile recovery update verified. Other plugin functions and menu values preserved.');
