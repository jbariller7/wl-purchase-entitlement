/* Preserve the existing MailerLite form and its confirmed-success callback. */
(() => {
  'use strict';
  const sections = [...document.querySelectorAll('.beyond-newsletter')];
  let messages = Object.fromEntries([...sections[0].querySelectorAll('[data-i18n]')].map(n => [n.dataset.i18n, n.textContent]));
  let lastForm = null;
  function localizeErrors() {
    for (const section of sections) {
      for (const node of section.querySelectorAll('.ml-server-error')) {
        if (node.textContent !== messages.nlError) node.textContent = messages.nlError;
      }
      for (const node of section.querySelectorAll('.ml-field-error-message')) {
        if (node.textContent && node.textContent !== messages.nlInvalid) node.textContent = messages.nlInvalid;
      }
    }
  }
  document.addEventListener('beyond:language', event => {
    messages = event.detail.text;
    for (const section of sections) {
      const email = section.querySelector('input[type="email"]');
      if (email.validity.customError) email.setCustomValidity(messages.nlInvalid);
    }
    localizeErrors();
  });
  for (const section of sections) {
    const email = section.querySelector('input[type="email"]');
    email.addEventListener('invalid', () => email.setCustomValidity(messages.nlInvalid || 'Enter a valid email address.'));
    email.addEventListener('input', () => email.setCustomValidity(''));
    section.querySelector('form').addEventListener('submit', () => { lastForm = section; }, true);
    new MutationObserver(localizeErrors).observe(section.querySelector('.ml-subscribe-form'), {childList:true, subtree:true, characterData:true});
  }
  window.ml_webform_success_47615766 = () => {
    for (const section of sections) {
      section.querySelector('.row-form').hidden = true;
      section.querySelector('.row-success').classList.add('newsletter-confirmed');
    }
    lastForm?.querySelector('.row-success').focus();
  };
})();
