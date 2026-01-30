function ensure(cond, msg) {
  if (!cond) throw new Error(msg);
}

export function validateApexClassAgainstBlueprint(intent, blueprint) {
  for (const method of intent.methods) {
    validateStatements(method.body, blueprint);
  }
  return true;
}

function validateStatements(stmts, blueprint) {
  for (const s of stmts) {
    if (s.type === 'SOQL_QUERY') {
      const obj = blueprint.objects[s.sObject];
      ensure(obj, `Unknown sObject in SOQL_QUERY: ${s.sObject}`);

      for (const f of s.fields) {
        ensure(obj.fields[f], `Unknown field in SOQL_QUERY: ${s.sObject}.${f}`);
      }
    }

    if (s.type === 'SET_FIELD') {
      // expects "acc.Field__c" style
      const m = String(s.target).match(/^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z0-9_]+)$/);
      ensure(m, `Invalid SET_FIELD target: ${s.target}`);
      // We can’t always know variable type here without full type inference,
      // so keep it light for now (or add optional varTypes map later).
    }

    if (s.type === 'FOR_EACH') validateStatements(s.body, blueprint);
    if (s.type === 'IF_ELSE') { validateStatements(s.then, blueprint); validateStatements(s.else, blueprint); }
  }
}
