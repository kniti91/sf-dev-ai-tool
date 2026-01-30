export function stableSortByName(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  return [...items].sort((a, b) => String(a?.name ?? '').localeCompare(String(b?.name ?? '')));
}
