import type { androidpublisher_v3 } from "googleapis";
import { describe, expect, it, vi } from "vitest";
import type { EntitlementStore } from "../src/infrastructure/entitlement-store.js";
import { sha256 } from "../src/infrastructure/ids.js";
import {
  googlePlayOutOfAppPurchaseContext,
  googlePlaySubscriptionAcknowledgeRequest,
  resolveGooglePlayPurchaseIdentity
} from "../src/providers/google-play/service.js";

function playTokenId(token: string): string {
  return `play_${sha256(token)}`;
}

function store(overrides: Partial<Record<
  "uidForStoreAccountToken" |
  "uidForProviderTransaction" |
  "uidForProviderTransactionForAttribution" |
  "uidForProviderSubscriptionForAttribution",
  ReturnType<typeof vi.fn>
>> = {}): EntitlementStore {
  return {
    uidForStoreAccountToken: vi.fn().mockResolvedValue(undefined),
    uidForProviderTransaction: vi.fn().mockResolvedValue(undefined),
    uidForProviderTransactionForAttribution: vi.fn().mockResolvedValue(undefined),
    uidForProviderSubscriptionForAttribution: vi.fn().mockResolvedValue(undefined),
    ...overrides
  } as unknown as EntitlementStore;
}

describe("Google Play purchase identity", () => {
  it("extracts the Play subscriptions-center repurchase context and builds the supported acknowledgement body", () => {
    const purchase = {
      outOfAppPurchaseContext: {
        expiredExternalAccountIdentifiers: { obfuscatedExternalAccountId: " stable-account-token " },
        expiredPurchaseToken: " expired-purchase-token "
      }
    } as unknown as androidpublisher_v3.Schema$SubscriptionPurchaseV2;

    expect(googlePlayOutOfAppPurchaseContext(purchase)).toEqual({
      expiredAccountToken: "stable-account-token",
      expiredPurchaseToken: "expired-purchase-token"
    });
    expect(googlePlaySubscriptionAcknowledgeRequest("stable-account-token")).toEqual({
      externalAccountIds: { obfuscatedAccountId: "stable-account-token" }
    });
    expect(googlePlaySubscriptionAcknowledgeRequest()).toEqual({});
  });

  it("attributes an out-of-app repurchase through the prior stored purchase-token link", async () => {
    const uidForProviderSubscriptionForAttribution = vi.fn().mockImplementation(
      async (_provider: string, id: string) => id === playTokenId("expired-token") ? "returning-player" : undefined
    );
    const result = await resolveGooglePlayPurchaseIdentity({
      store: store({ uidForProviderSubscriptionForAttribution }),
      currentProviderTransactionId: playTokenId("new-token"),
      expiredPurchaseToken: "expired-token"
    });

    expect(result).toEqual({ uid: "returning-player", attributionVerified: true });
    expect(uidForProviderSubscriptionForAttribution).toHaveBeenCalledWith(
      "google_play",
      playTokenId("expired-token")
    );
  });

  it("attributes an out-of-app repurchase through its prior obfuscated WonderLang account token", async () => {
    const uidForStoreAccountToken = vi.fn().mockImplementation(
      async (token: string) => token === "prior-account-token" ? "returning-player" : undefined
    );
    await expect(resolveGooglePlayPurchaseIdentity({
      store: store({ uidForStoreAccountToken }),
      currentProviderTransactionId: playTokenId("new-token"),
      expiredAccountToken: "prior-account-token"
    })).resolves.toEqual({ uid: "returning-player", attributionVerified: true });
  });

  it("rejects disagreement between the prior account token and prior purchase owner", async () => {
    await expect(resolveGooglePlayPurchaseIdentity({
      store: store({
        uidForStoreAccountToken: vi.fn().mockResolvedValue("account-token-owner"),
        uidForProviderSubscriptionForAttribution: vi.fn().mockResolvedValue("purchase-token-owner")
      }),
      expiredAccountToken: "prior-account-token",
      expiredPurchaseToken: "expired-purchase-token"
    })).rejects.toThrow(/account identifiers disagree/i);
  });

  it("allows retained lifecycle audit for a deleted account but refuses purchase attribution", async () => {
    await expect(resolveGooglePlayPurchaseIdentity({
      store: store({
        uidForProviderTransaction: vi.fn().mockResolvedValue("deleted_uid_hash"),
        uidForProviderTransactionForAttribution: vi.fn().mockResolvedValue(undefined)
      }),
      currentProviderTransactionId: playTokenId("existing-token")
    })).resolves.toEqual({ uid: "deleted_uid_hash", attributionVerified: false });
  });

  it("rejects an unlinked purchase and a client claiming a transaction owned by another account", async () => {
    await expect(resolveGooglePlayPurchaseIdentity({ store: store() }))
      .rejects.toThrow(/not linked/i);
    await expect(resolveGooglePlayPurchaseIdentity({
      store: store({
        uidForProviderTransaction: vi.fn().mockResolvedValue("original-owner"),
        uidForProviderTransactionForAttribution: vi.fn().mockResolvedValue("original-owner")
      }),
      currentProviderTransactionId: "GPA.existing-order",
      authenticatedUid: "different-player"
    })).rejects.toThrow(/account identifiers disagree/i);
  });
});
