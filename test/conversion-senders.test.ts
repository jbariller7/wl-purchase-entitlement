import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvironmentForTests } from "../src/config/env.js";
import { sendMetaConversion, sendTikTokConversion } from "../src/ads/conversion-senders.js";

const original = { ...process.env };
const payload = {
  eventName: "Purchase",
  eventId: "cs_conversion",
  eventTime: 1_787_659_200,
  eventSourceUrl: "https://wonderlang.net/account/",
  emailSha256: "a".repeat(64),
  ipAddress: "192.0.2.10",
  userAgent: "WonderLang Test Browser",
  fbp: "fb.1.test",
  fbc: "fb.1.click",
  ttclid: "tiktok-click-test",
  ttp: "tiktok-cookie-test",
  value: 59.99,
  currency: "USD",
  product: "premium_lifetime_pass"
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(process.env, {
    META_PIXEL_ID: "meta-pixel-test",
    META_ACCESS_TOKEN: "meta-token-test",
    META_GRAPH_API_VERSION: "v23.0",
    META_TEST_EVENT_CODE: "META_TEST_CODE",
    TIKTOK_PIXEL_ID: "tiktok-pixel-test",
    TIKTOK_ACCESS_TOKEN: "tiktok-token-test",
    TIKTOK_TEST_EVENT_CODE: "TIKTOK_TEST_CODE"
  });
  resetEnvironmentForTests();
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  process.env = { ...original };
  resetEnvironmentForTests();
  vi.unstubAllGlobals();
});

describe("advertising conversion delivery", () => {
  it("sends matching stable event IDs and privacy-reduced user data to Meta and TikTok", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, message: "OK" }), { status: 200 }));

    await sendMetaConversion(payload);
    await sendTikTokConversion(payload);

    expect(fetch).toHaveBeenCalledTimes(2);
    const [metaUrl, metaOptions] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(metaUrl).toBe("https://graph.facebook.com/v23.0/meta-pixel-test/events");
    const metaBody = JSON.parse(String(metaOptions?.body));
    expect(metaBody).toMatchObject({
      access_token: "meta-token-test",
      test_event_code: "META_TEST_CODE",
      data: [{
        event_name: "Purchase",
        event_time: payload.eventTime,
        event_id: "cs_conversion",
        action_source: "website",
        event_source_url: payload.eventSourceUrl,
        user_data: {
          em: [payload.emailSha256],
          client_ip_address: payload.ipAddress,
          client_user_agent: payload.userAgent,
          fbp: payload.fbp,
          fbc: payload.fbc
        },
        custom_data: {
          currency: "USD",
          value: 59.99,
          content_ids: ["premium_lifetime_pass"],
          content_type: "product"
        }
      }]
    });

    const [tiktokUrl, tiktokOptions] = vi.mocked(fetch).mock.calls[1] ?? [];
    expect(tiktokUrl).toBe("https://business-api.tiktok.com/open_api/v1.3/event/track/");
    expect(new Headers(tiktokOptions?.headers).get("access-token")).toBe("tiktok-token-test");
    const tiktokBody = JSON.parse(String(tiktokOptions?.body));
    expect(tiktokBody).toMatchObject({
      event_source: "web",
      event_source_id: "tiktok-pixel-test",
      test_event_code: "TIKTOK_TEST_CODE",
      data: [{
        event: "Purchase",
        event_time: payload.eventTime,
        event_id: "cs_conversion",
        page: { url: payload.eventSourceUrl },
        user: {
          email: [payload.emailSha256],
          ip: payload.ipAddress,
          user_agent: payload.userAgent,
          ttclid: payload.ttclid,
          ttp: payload.ttp
        },
        properties: {
          currency: "USD",
          value: 59.99,
          content_type: "product",
          quantity: 1,
          price: 59.99
        }
      }]
    });
    expect(JSON.stringify(metaBody)).not.toContain("@example.com");
    expect(JSON.stringify(tiktokBody)).not.toContain("@example.com");
  });

  it("keeps provider response bodies out of operational errors", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("private Meta diagnostic", { status: 503 }));
    const metaError = await sendMetaConversion(payload).then(() => undefined, (error: unknown) => error as Error);
    expect(metaError?.message).toBe("Meta conversion failed (503).");
    expect(metaError?.message).not.toContain("private Meta diagnostic");

    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ code: 40002, message: "private TikTok diagnostic" }), { status: 200 }));
    const tiktokError = await sendTikTokConversion(payload).then(() => undefined, (error: unknown) => error as Error);
    expect(tiktokError?.message).toBe("TikTok conversion rejected (40002).");
    expect(tiktokError?.message).not.toContain("private TikTok diagnostic");
  });
});
