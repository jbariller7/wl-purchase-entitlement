import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, it, expect, vi } from 'vitest';
import { languages, translateSummary } from '../integrations/web/account-widget/account-languages.js';
const source = readFileSync(new URL('../integrations/web/account-widget/wonderlang-account.js', import.meta.url), 'utf8');
function setup() {
  const values = new Map([['wl-email-link', 'old@example.com']]);
  const button = { disabled: false }, notice = { hidden: true, textContent: '' };
  const ctx = { URL, location: { href: 'https://example.com/account/?mode=signIn&oobCode=old&apiKey=public&continueUrl=old', pathname: '/account/' },
    document: {title: 'Account'}, history: {replaceState: vi.fn()},
    localStorage: {getItem: k => values.get(k), setItem: (k,v) => values.set(k,v), removeItem: k => values.delete(k)},
    isSignInWithEmailLink: () => true, sendSignInLinkToEmail: vi.fn().mockResolvedValue(),
    signInWithEmailLink: vi.fn().mockResolvedValue(), friendlyAccountError: e => e.message };
  vm.createContext(ctx);
  vm.runInContext('class Flow {' + source.slice(source.indexOf('  async sendEmailLink('), source.indexOf('  confirmEmailForLink(')) + '} globalThis.Flow=Flow;', ctx);
  const flow = new ctx.Flow();
  Object.assign(flow, {auth: {currentUser: {uid:'u'}}, querySelector: s => s.includes('button') ? button : notice,
    status: vi.fn(), fail: vi.fn(), renderUser: vi.fn(), confirmEmailForLink: vi.fn().mockResolvedValue('buyer@example.com')});
  return {ctx, flow, button, notice};
}
describe('email-link sign-in', () => {
  it('requires confirmation and uses the confirmed address, not stale browser storage', async () => {
    const {ctx,flow} = setup(); await flow.finishEmailLink();
    expect(flow.confirmEmailForLink).toHaveBeenCalledWith(expect.objectContaining({email:'old@example.com'}));
    expect(ctx.signInWithEmailLink).toHaveBeenCalledWith(flow.auth,'buyer@example.com',ctx.location.href);
    expect(ctx.history.replaceState).toHaveBeenCalled();
  });
  it('does not consume the link until the user confirms, including concurrent calls', async () => {
    const {ctx,flow} = setup(); let resolve;
    flow.confirmEmailForLink.mockImplementation(() => new Promise(r => {resolve=r;}));
    const pending = flow.finishEmailLink(); await flow.finishEmailLink();
    expect(ctx.signInWithEmailLink).not.toHaveBeenCalled();
    resolve(null); await pending;
    expect(ctx.signInWithEmailLink).not.toHaveBeenCalled();
    expect(flow.emailFinishing).toBe(false);
  });
  it('shows a persistent sent notice, prevents double sends, and removes stale action parameters', async () => {
    const {ctx,flow,button,notice} = setup(); let resolve;
    ctx.sendSignInLinkToEmail.mockImplementation(() => new Promise(r => {resolve=r;}));
    const pending=flow.sendEmailLink('buyer@example.com',false);
    expect(button.disabled).toBe(true); expect(notice.textContent).toBe('Sending email…');
    await flow.sendEmailLink('buyer@example.com',false);
    expect(ctx.sendSignInLinkToEmail).toHaveBeenCalledTimes(1);
    const url = new URL(ctx.sendSignInLinkToEmail.mock.calls[0][2].url);
    expect([...url.searchParams.keys()]).toEqual(['link_email']);
    resolve(); await pending;
    expect(notice.hidden).toBe(false); expect(notice.textContent).toContain('spam folder');
    expect(button.disabled).toBe(false);
  });
  it('shows send errors and releases the button', async () => {
    const {ctx,flow,button,notice}=setup();
    ctx.sendSignInLinkToEmail.mockRejectedValue(new Error('Network unavailable'));
    await flow.sendEmailLink('buyer@example.com',false);
    expect(notice.textContent).toBe('Network unavailable'); expect(button.disabled).toBe(false);
  });
  it('translates new email messages for every account language', () => {
    for (const [locale] of languages.filter(([code])=>code!=='en')) {
      for (const message of ['Sending email…','Email sent. Check your inbox and spam folder, then open the latest sign-in link.','Confirm the email address that received this sign-in link. Change it below if needed.']) {
        expect(translateSummary(message,locale)).not.toBe(message);
      }
    }
  });
});
