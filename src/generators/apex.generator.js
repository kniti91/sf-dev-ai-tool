function indent(n) { return '  '.repeat(n); }

function lit(v) {
  if (v === null) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  // treat as string
  return `'${String(v).replace(/'/g, "\\'")}'`;
}

function compileCondition(c) {
  const right = c.right !== undefined ? lit(c.right) : (c.rightRef ? c.rightRef : 'null');
  switch (c.op) {
    case 'EQUALS': return `${c.left} == ${right}`;
    case 'NOT_EQUALS': return `${c.left} != ${right}`;
    default: throw new Error(`Unsupported condition op: ${c.op}`);
  }
}

function compileWhere(w) {
  // supports:
  // { field:"Id", op:"IN", valueRef:"accountIds" } OR
  // { field:"Industry", op:"EQUALS", value:"Finance" }
  if (w.op === 'IN') {
    if (!w.valueRef) throw new Error('WHERE IN requires valueRef');
    return `${w.field} IN :${w.valueRef}`;
  }
  if (w.op === 'EQUALS') {
    return `${w.field} = ${lit(w.value)}`;
  }
  if (w.op === 'NOT_EQUALS') {
    return `${w.field} != ${lit(w.value)}`;
  }
  throw new Error(`Unsupported WHERE op: ${w.op}`);
}

function compileStmt(s, level) {
  switch (s.type) {
    case 'SOQL_QUERY': {
      const fields = s.fields.join(', ');
      const where = compileWhere(s.where);
      const lim = Number(s.limit);
      return `${indent(level)}List<${s.sObject}> ${s.into} = [\n` +
             `${indent(level+1)}SELECT ${fields}\n` +
             `${indent(level+1)}FROM ${s.sObject}\n` +
             `${indent(level+1)}WHERE ${where}\n` +
             `${indent(level+1)}LIMIT ${lim}\n` +
             `${indent(level)}];`;
    }

    case 'FOR_EACH': {
      const item = `${s.item.type} ${s.item.name}`;
      const body = s.body.map(x => compileStmt(x, level+1)).join('\n');
      return `${indent(level)}for (${item} : ${s.collection}) {\n${body}\n${indent(level)}}`;
    }

    case 'IF_ELSE': {
      const cond = compileCondition(s.condition);
      const thenBody = s.then.map(x => compileStmt(x, level+1)).join('\n');
      const elseBody = s.else.map(x => compileStmt(x, level+1)).join('\n');
      return `${indent(level)}if (${cond}) {\n${thenBody}\n${indent(level)}} else {\n${elseBody}\n${indent(level)}}`;
    }

    case 'SET_FIELD':
      return `${indent(level)}${s.target} = ${lit(s.value)};`;

    case 'DML_UPDATE':
      return `${indent(level)}update ${s.target};`;

    case 'DML_INSERT':
      return `${indent(level)}insert ${s.target};`;

    case 'RETURN':
      return `${indent(level)}return${s.returnValue !== undefined ? ' ' + lit(s.returnValue) : ''};`;

    default:
      throw new Error(`Unsupported statement type: ${s.type}`);
  }
}

function compileMethod(m) {
  const params = (m.params || []).map(p => `${p.type} ${p.name}`).join(', ');
  const header = `public static ${m.returnType} ${m.name}(${params})`;

  // basic null guard if first param exists and is sObject-ish
  const guards = [];
  if ((m.params || []).length > 0) {
    const p0 = m.params[0].name;
    guards.push(`if (${p0} == null) return${m.returnType === 'void' ? '' : ' null'};`);
  }

  const bodyStmts = (m.body || []).map(s => compileStmt(s, 2)).join('\n\n');
  const guardLines = guards.length ? `${indent(2)}${guards.join('\n' + indent(2))}\n\n` : '';

  return `${indent(1)}${header} {\n${guardLines}${bodyStmts}\n${indent(1)}}`;
}

export function generateApexClass(intent) {
  const sharing = intent.withSharing ? 'with sharing' : 'without sharing';
  const methods = intent.methods.map(compileMethod).join('\n\n');
  return `${intent.accessModifier} ${sharing} class ${intent.className} {\n\n${methods}\n\n}`;
}
