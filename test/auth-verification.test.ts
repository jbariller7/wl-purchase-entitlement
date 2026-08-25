import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyIdToken = vi.fn();

vi.mock("../src/infrastructure/firebase.js", () => ({
  firebaseAuth: () => ({ verifyIdToken })
}));

import { requireUser } from "../src/http/auth.js";

describe("Firebase request authentication", () => {
  beforeEach(() => {
    verifyIdToken.mockReset();
    vi.restoreAllMocks();
  });

  it("requires the revocation-aware result even when the token signature is valid", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    verifyIdToken
      .mockRejectedValueOnce(new Error("Credential rejected for service@example.com with AIzaExampleSecret123456789012345"))
      .mockResolvedValueOnce({ uid: "user-1" });

    await expect(requireUser("Bearer secret-token-value")).rejects.toMatchObject({
      status: 401,
      message: "The Firebase ID token is invalid or revoked."
    });
    expect(verifyIdToken).toHaveBeenNthCalledWith(1, "secret-token-value", true);
    expect(verifyIdToken).toHaveBeenNthCalledWith(2, "secret-token-value", false);
    expect(warning).toHaveBeenCalledWith("Firebase ID token verification rejected", {
      signatureValid: true,
      error: "Credential rejected for [redacted-email] with [redacted-secret]"
    });
    expect(JSON.stringify(warning.mock.calls)).not.toContain("secret-token-value");
  });

  it("accepts only the revocation-aware verification result", async () => {
    verifyIdToken.mockResolvedValueOnce({ uid: "user-1" });
    await expect(requireUser("Bearer valid-token")).resolves.toMatchObject({ uid: "user-1" });
    expect(verifyIdToken).toHaveBeenCalledOnce();
    expect(verifyIdToken).toHaveBeenCalledWith("valid-token", true);
  });
});
