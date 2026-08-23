# Website account widget

Embed the generated script and custom element on `wonderlang.net`:

```html
<link rel="stylesheet" href="https://purchased-keys-automation.netlify.app/wonderlang-account.css">
<script src="https://purchased-keys-automation.netlify.app/wonderlang-account.js" defer></script>
<wonderlang-account api-base="https://purchased-keys-automation.netlify.app"></wonderlang-account>
```

The widget offers Google, Apple and passwordless email-link sign-in; account status; monthly and lifetime checkout; Stripe Billing Portal; subscription-to-lifetime confirmation; and a verified historical-purchase claim for the private 50% offer.

Firebase Console must enable Google, Apple and Email Link providers and authorize both `wonderlang.net` and the Netlify domain. Apple web sign-in also requires an Apple Services ID and return URL configured to Firebase's auth handler.
