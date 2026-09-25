import { afterEach, describe, expect, it, vi } from 'vitest';
import { installAccountLanguagePicker, languages, translateSummary } from '../integrations/web/account-widget/account-languages.js';
import { loginText } from '../integrations/web/account-widget/login-text.js';
import { providerChoiceText } from '../integrations/web/account-widget/provider-choice-text.js';

afterEach(() => vi.unstubAllGlobals());

describe('account sign-in localization', () => {
  it('covers every sign-in string in every selectable language', () => {
    expect(Object.keys(loginText).sort()).toEqual(languages.map(([code]) => code).sort());
    for (const [locale] of languages) {
      expect(loginText[locale]).toHaveLength(loginText.en.length);
      loginText.en.forEach((source, index) => {
        expect(loginText[locale][index].trim()).not.toBe('');
        expect(translateSummary(source, locale)).toBe(loginText[locale][index]);
      });
      expect(translateSummary(providerChoiceText.en, locale)).toBe(providerChoiceText[locale]);
    }
    expect(translateSummary('Email me a sign-in link', 'fr')).toBe('Recevoir un lien de connexion');
    expect(translateSummary('customer@example.com', 'fr')).toBe('customer@example.com');
  });

  it('translates status updates and switches languages without changing user content', () => {
    let observeChanges;
    let changeLanguage;
    const select = {value: '', addEventListener: (_, callback) => {changeLanguage = callback;}};
    const control = {querySelector: () => select};
    const node = (value, selector) => ({nodeValue: value, parentElement: {closest: exclusions => exclusions.split(',').includes(selector)}});
    const status = node(providerChoiceText.en, '.wl-status');
    const label = node('  Email me a sign-in link  ', 'button');
    const userContent = node('Continue', '[data-user-content]');
    const nodes = [status, label, userContent];
    const root = {querySelector: () => ({append() {}})};
    vi.stubGlobal('localStorage', {getItem: () => 'fr', setItem() {}});
    vi.stubGlobal('NodeFilter', {SHOW_TEXT: 4});
    vi.stubGlobal('document', {createElement: () => control, createTreeWalker: () => {
      let index = 0;
      return {nextNode: () => nodes[index++]};
    }});
    vi.stubGlobal('MutationObserver', class {
      constructor(callback) {observeChanges = callback;}
      disconnect() {}
      observe() {}
    });
    const cleanup = installAccountLanguagePicker(root);
    expect(status.nodeValue).toBe(providerChoiceText.fr);
    expect(label.nodeValue).toBe('  Recevoir un lien de connexion  ');
    expect(userContent.nodeValue).toBe('Continue');
    select.value = 'es'; changeLanguage();
    expect(status.nodeValue).toBe(providerChoiceText.es);
    status.nodeValue = 'Opening secure sign-in…'; observeChanges();
    expect(status.nodeValue).toBe('Abriendo el acceso seguro…');
    select.value = 'en'; changeLanguage();
    expect(status.nodeValue).toBe('Opening secure sign-in…');
    expect(label.nodeValue).toBe('  Email me a sign-in link  ');
    select.value = 'ar'; changeLanguage();
    expect(root.dir).toBe('rtl');
    select.value = 'fr'; changeLanguage();
    expect(root.dir).toBe('ltr');
    cleanup();
  });
});
