function ensure(cond, msg) {
  if (!cond) throw new Error(msg);
}

function getObjectBlueprint(blueprint, objectName) {
  return blueprint?.objects?.[objectName] || null;
}

function fieldExists(objBp, apiName) {
  return !!objBp?.fields?.[apiName];
}

function isValidNumberConfig(field) {
  // Salesforce Number fields require precision; scale default 0
  if (field.precision == null) return false;
  if (field.scale == null) return true;
  return Number(field.scale) <= Number(field.precision);
}

export function validateCreateFieldAgainstBlueprint(intent, blueprint) {
  ensure(intent?.intent === 'CREATE_FIELD', 'Invalid intent for blueprint validator.');

  const objName = intent.object;
  const objBp = getObjectBlueprint(blueprint, objName);
  ensure(objBp, `Object not found in org blueprint: ${objName}`);

  const apiName = intent.field.apiName;
  ensure(apiName, 'Missing field.apiName');
  ensure(!fieldExists(objBp, apiName), `Field already exists: ${objName}.${apiName}`);

  const type = intent.field.type;
  ensure(type, 'Missing field.type');

  // Minimal type rules (extend later)
  const allowed = new Set(['Text', 'Number', 'Checkbox', 'Date', 'Picklist']);
  ensure(allowed.has(type), `Unsupported field type: ${type}`);

  if (type === 'Text') {
    ensure(intent.field.length != null, 'Text field requires length');
    ensure(Number(intent.field.length) >= 1 && Number(intent.field.length) <= 255, 'Text length must be 1..255');
  }

  if (type === 'Number') {
    ensure(isValidNumberConfig(intent.field), 'Number field requires precision and scale <= precision');
    // Typical max precision is 18 in SF (keep conservative)
    ensure(Number(intent.field.precision) >= 1 && Number(intent.field.precision) <= 18, 'Number precision must be 1..18');
    if (intent.field.scale != null) {
      ensure(Number(intent.field.scale) >= 0 && Number(intent.field.scale) <= 18, 'Number scale must be 0..18');
    }
  }

  if (type === 'Picklist') {
    const values = intent.field.values;
    ensure(Array.isArray(values) && values.length > 0, 'Picklist requires field.values array');
  }

  // All good
  return true;
}
