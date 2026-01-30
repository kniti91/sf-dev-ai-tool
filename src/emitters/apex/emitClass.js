export default function emitClass(component) {

    const lines = [];

    lines.push(`public with sharing class ${component.name} {`);
    lines.push(``);

    lines.push(`    public static void execute(List<SObject> records) {`);

    for (const op of component.operations) {

        lines.push(`        ${emitOperation(op)}`);
    }

    lines.push(`    }`);
    lines.push(`}`);

    return lines.join('\n');
}

function emitOperation(op) {

    switch(op.op) {

        case 'query':
            return `List<${op.sobject}> results = [SELECT ${op.fields.join(',')} FROM ${op.sobject} LIMIT ${op.limit || 200}];`;

        case 'update':
            return `update ${op.target};`;

        case 'insert':
            return `insert ${op.target};`;

        case 'guard':
            return `
if(!(${op.condition})) {
    throw new AutomationException('${op.code}', '${op.message}');
}`.trim();

        default:
            throw new Error(`Unsupported op: ${op.op}`);
    }
}
