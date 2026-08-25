const providerLabels = new Map([
  ["google", "Google"],
  ["google.com", "Google"],
  ["apple", "Apple"],
  ["apple.com", "Apple"],
  ["password", "Email"],
  ["email", "Email"],
  ["email-link", "Email"],
  ["passwordless-email", "Email"]
]);

export function friendlyLoginProvider(providerId) {
  const normalized = String(providerId ?? "").trim().toLowerCase();
  if (!normalized) return null;
  return providerLabels.get(normalized) || "Other sign-in";
}

export function formatLoginProviders(providerIds) {
  const labels = [...new Set((providerIds || []).map(friendlyLoginProvider).filter(Boolean))];
  return labels.join(", ") || "Email link";
}
