import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const authDomain = "wonderlang-accounts.firebaseapp.com";
const packageName = "com.wonderlang.app";
const expectedSha256Fingerprints = [
  "93:93:C8:45:B9:2B:B0:BA:17:9B:19:C2:FD:F7:C2:8F:25:B4:3C:EB:44:6D:28:6C:44:0C:4A:53:40:37:00:F0",
  "1D:3C:B3:12:24:72:C1:EB:52:E7:B2:CD:48:EF:F5:AC:41:32:8C:FA:55:AE:6C:87:A1:5A:7F:10:B7:17:C0:C6",
  "1E:DB:70:E1:65:46:AA:57:82:C8:7F:D7:92:DF:F4:A9:36:53:77:A2:74:5B:B2:4D:1D:00:FA:D7:B6:C5:44:39",
];

describe("Android passwordless-email App Links", () => {
  it("publishes a complete Digital Asset Links association for every supported signing certificate", () => {
    const statements = JSON.parse(read("firebase-hosting/.well-known/assetlinks.json"));
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatchObject({
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: packageName,
      },
    });
    expect(statements[0].target.sha256_cert_fingerprints).toEqual(expectedSha256Fingerprints);
    for (const fingerprint of statements[0].target.sha256_cert_fingerprints) {
      expect(fingerprint).toMatch(/^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    }
  });

  it("deploys only the public association file to the isolated Firebase Hosting site", () => {
    const config = JSON.parse(read("firebase.json"));
    expect(config.hosting).toMatchObject({
      site: "wonderlang-accounts",
      public: "firebase-hosting",
    });
    const assetLinksHeaders = config.hosting.headers.find(
      (entry: { source: string }) => entry.source === "/.well-known/assetlinks.json",
    );
    expect(assetLinksHeaders?.headers).toEqual(
      expect.arrayContaining([
        { key: "Content-Type", value: "application/json; charset=utf-8" },
        { key: "X-Content-Type-Options", value: "nosniff" },
      ]),
    );
  });

  it("keeps the Android link generator and manifest on the same verified Hosting route", () => {
    const manager = read(
      "integrations/android/current-app-mirror/app/src/main/java/com/example/wonderlang/WonderLangAccountManager.kt",
    );
    const manifest = read("integrations/android/current-app-mirror/app/src/main/AndroidManifest.xml");
    const gradle = read("integrations/android/current-app-mirror/app/build.gradle.kts");

    expect(manager).toContain(`.setLinkDomain("${authDomain}")`);
    expect(manager).toContain(".setAndroidPackageName(activity.packageName, false, null)");
    expect(gradle).toContain(`applicationId = "${packageName}"`);
    expect(manifest).toContain('android:autoVerify="true"');
    expect(manifest).toContain(`android:host="${authDomain}"`);
    expect(manifest).toContain('android:pathPrefix="/__/auth/links"');
  });
});
