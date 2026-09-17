# Cloud-sync menu translations

`cloud-sync-menu-translations.json` contains the 56 reviewed cloud-sync keys for all 24 WonderLang base-language/script sections. Merge these keys into the corresponding `translations` sections of the existing `texts/menu.json`; this extract is not a replacement for the complete game menu file.

The September 17 wording update changes the unsynced-save prompt, labels the action “Cloud sync now,” and localizes explicit save/transfer/verification/session failures. Preserve `{PROFILE}`, `{OWNER}`, `{ACTIVE}`, `{ERROR}`, and `{STATUS}` tokens wherever present. Profile names remain user data.

The live RMMZ and Android projects have the updated complete menu file and plugins. No APK is included here. Existing runtime and integration tests passed (25 and 45 tests respectively). English and French prompt layouts were checked in an isolated browser fixture; installed Android display was not retested for this text-only update.
