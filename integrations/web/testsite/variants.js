// Codex authors both versions here, in content.json and in site.css.
// Localized overrides are manually authored; arrays replace the shared array.
// Every build freezes the HTML, CSS, JS and assets under a content-addressed URL.
export const variants = {
  A: { label: 'Adventure + demo first', heroKey: 'heroA', primary: 'play', reverseHero: false, content: {}, sectionOrder: [] },
  B: { label: 'Language goal + editions first', heroKey: 'heroB', primary: 'buy', reverseHero: true, content: {}, sectionOrder: [] }
};
export function variantContent(shared, overrides) {
  const result = { ...shared };
  for (const [key, value] of Object.entries(overrides || {})) {
    result[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? variantContent(shared[key] || {}, value) : value;
  }
  return result;
}
