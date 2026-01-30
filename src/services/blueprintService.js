import { extractOrgBlueprint } from '../salesforce/blueprint.js';
import fs from 'fs';

export async function buildAndStoreBlueprint(conn) {
  const blueprint = await extractOrgBlueprint(conn);

  // TEMP storage (Phase-1)
  fs.writeFileSync(
    './org-blueprint.json',
    JSON.stringify(blueprint, null, 2)
  );

  return blueprint;
}
