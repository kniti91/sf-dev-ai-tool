import fs from 'fs';

export function loadBlueprintFromDisk() {
  const raw = fs.readFileSync('./org-blueprint.json', 'utf-8');
  return JSON.parse(raw);
}
