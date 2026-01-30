function ensure(cond, msg) {
  if (!cond) throw new Error(msg);
}

export function validateValidationRuleAgainstBlueprint(intent, blueprint) {
  const obj = blueprint.objects[intent.object];
  ensure(obj, `Object not found: ${intent.object}`);

  // Validate referenced fields in formula (simple heuristic)
  Object.keys(obj.fields).forEach(() => {}); // placeholder for future parser

  if (intent.errorLocation === 'Field') {
    ensure(intent.errorField, 'errorField required when errorLocation = Field');
    ensure(
      obj.fields[intent.errorField],
      `Error field does not exist: ${intent.errorField}`
    );
  }

  // Basic sanity check
  ensure(
    typeof intent.formula === 'string' && intent.formula.length > 0,
    'Formula must be a non-empty string'
  );

  return true;
}
