export async function extractOrgBlueprint(conn) {
  const blueprint = {
    extractedAt: new Date().toISOString(),
    objects: {}
  };

  // 1️⃣ Get all objects
  const global = await conn.describeGlobal();

  // Filter to custom + key standard objects (keep it small)
  const allowedObjects = global.sobjects.filter(
    o => o.custom || ['Account', 'Contact', 'Case'].includes(o.name)
  );

  // 2️⃣ Describe each object
  for (const obj of allowedObjects) {
    const desc = await conn.describe(obj.name);

    blueprint.objects[obj.name] = {
      label: desc.label,
      custom: desc.custom,
      fields: {}
    };

    for (const field of desc.fields) {
      const fieldDef = {
        type: field.type,
        required: !field.nillable,
      };

      if (field.length) fieldDef.length = field.length;
      if (field.precision) fieldDef.precision = field.precision;
      if (field.scale) fieldDef.scale = field.scale;

      if (field.picklistValues?.length) {
        fieldDef.values = field.picklistValues
          .filter(v => v.active)
          .map(v => v.value);
      }

      blueprint.objects[obj.name].fields[field.name] = fieldDef;
    }
  }

  return blueprint;
}
