function ensure(cond, msg) {
  if (!cond) throw new Error(msg);
}

export function validateApexIR(intent) {
  for (const m of intent.methods) {
    // Track nesting to block SOQL/DML inside loops
    validateStatements(m.body, { inLoop: false });
  }
  return true;
}

function validateStatements(stmts, ctx) {
  for (const s of stmts) {
    ensure(s.type, 'Statement missing type');

    if (s.type === 'FOR_EACH') {
      ensure(s.item?.name && s.item?.type, 'FOR_EACH requires item {type,name}');
      ensure(s.collection, 'FOR_EACH requires collection');
      ensure(Array.isArray(s.body), 'FOR_EACH requires body[]');

      validateStatements(s.body, { inLoop: true });
      continue;
    }

    if (s.type === 'SOQL_QUERY') {
      ensure(!ctx.inLoop, 'SOQL_QUERY is not allowed inside FOR_EACH (prevents SOQL-in-loop)');
      ensure(s.into && s.sObject, 'SOQL_QUERY requires into and sObject');
      ensure(Array.isArray(s.fields) && s.fields.length > 0, 'SOQL_QUERY requires fields[]');
      ensure(s.where && s.limit != null, 'SOQL_QUERY requires where and limit');
      ensure(Number(s.limit) > 0 && Number(s.limit) <= 2000, 'SOQL_QUERY limit must be 1..2000');
      continue;
    }

    if (s.type === 'DML_UPDATE' || s.type === 'DML_INSERT') {
      ensure(!ctx.inLoop, 'DML is not allowed inside FOR_EACH (bulk safety)');
      ensure(typeof s.target === 'string', 'DML_* requires target list var name');
      continue;
    }

    if (s.type === 'IF_ELSE') {
      ensure(s.condition?.left && s.condition?.op, 'IF_ELSE requires condition');
      ensure(Array.isArray(s.then) && Array.isArray(s.else), 'IF_ELSE requires then[] and else[]');
      validateStatements(s.then, ctx);
      validateStatements(s.else, ctx);
      continue;
    }

    if (s.type === 'SET_FIELD') {
      ensure(s.target && s.value !== undefined, 'SET_FIELD requires target and value');
      continue;
    }

    if (s.type === 'RETURN') {
      // returnValue optional for void
      continue;
    }

    throw new Error(`Unsupported statement type: ${s.type}`);
  }
}
