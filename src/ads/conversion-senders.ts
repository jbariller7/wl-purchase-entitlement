import { env } from "../config/env.js";

interface ConversionPayload {
  eventName: "Purchase" | "Subscribe" | "StartTrial";
  eventId: string;
  eventTime: number;
  eventSourceUrl: string;
  emailSha256?: string;
  ipAddress?: string;
  userAgent?: string;
  fbp?: string;
  fbc?: string;
  ttclid?: string;
  ttp?: string;
  value: number;
  currency: string;
  product: string;
}

function asConversion(payload: Record<string, unknown>): ConversionPayload {
  return payload as unknown as ConversionPayload;
}

export async function sendMetaConversion(raw: Record<string, unknown>): Promise<void> {
  const pixel = env().META_PIXEL_ID;
  const token = env().META_ACCESS_TOKEN;
  if (!pixel || !token) throw new Error("Meta conversion credentials are not configured.");
  const event = asConversion(raw);
  const userData: Record<string, unknown> = {
    ...(event.emailSha256 ? { em: [event.emailSha256] } : {}),
    ...(event.ipAddress ? { client_ip_address: event.ipAddress } : {}),
    ...(event.userAgent ? { client_user_agent: event.userAgent } : {}),
    ...(event.fbp ? { fbp: event.fbp } : {}),
    ...(event.fbc ? { fbc: event.fbc } : {})
  };
  const response = await fetch(`https://graph.facebook.com/${env().META_GRAPH_API_VERSION}/${pixel}/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      access_token: token,
      ...(env().META_TEST_EVENT_CODE ? { test_event_code: env().META_TEST_EVENT_CODE } : {}),
      data: [{
        event_name: event.eventName,
        event_time: event.eventTime,
        event_id: event.eventId,
        action_source: "website",
        event_source_url: event.eventSourceUrl,
        user_data: userData,
        custom_data: {
          currency: event.currency,
          value: event.value,
          content_ids: [event.product],
          content_type: "product"
        }
      }]
    }),
    signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) throw new Error(`Meta conversion failed (${response.status}).`);
}

export async function sendTikTokConversion(raw: Record<string, unknown>): Promise<void> {
  const pixel = env().TIKTOK_PIXEL_ID;
  const token = env().TIKTOK_ACCESS_TOKEN;
  if (!pixel || !token) throw new Error("TikTok conversion credentials are not configured.");
  const event = asConversion(raw);
  const response = await fetch("https://business-api.tiktok.com/open_api/v1.3/event/track/", {
    method: "POST",
    headers: {
      "Access-Token": token,
      "content-type": "application/json",
      accept: "application/json"
    },
    body: JSON.stringify({
      event_source: "web",
      event_source_id: pixel,
      ...(env().TIKTOK_TEST_EVENT_CODE ? { test_event_code: env().TIKTOK_TEST_EVENT_CODE } : {}),
      data: [{
        event: event.eventName,
        event_time: event.eventTime,
        event_id: event.eventId,
        page: { url: event.eventSourceUrl },
        user: {
          ...(event.emailSha256 ? { email: [event.emailSha256] } : {}),
          ...(event.ipAddress ? { ip: event.ipAddress } : {}),
          ...(event.userAgent ? { user_agent: event.userAgent } : {}),
          ...(event.ttclid ? { ttclid: event.ttclid } : {}),
          ...(event.ttp ? { ttp: event.ttp } : {})
        },
        properties: {
          currency: event.currency,
          value: event.value,
          contents: [{
            content_id: event.product,
            content_name: event.product,
            content_type: "product",
            quantity: 1,
            price: event.value
          }],
          content_type: "product",
          quantity: 1,
          price: event.value
        }
      }]
    }),
    signal: AbortSignal.timeout(20_000)
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`TikTok conversion failed (${response.status}).`);
  const parsed = JSON.parse(body) as { code?: number; message?: string };
  if (parsed.code && parsed.code !== 0) throw new Error(`TikTok conversion rejected (${parsed.code}).`);
}
