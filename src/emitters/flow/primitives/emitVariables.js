import escapeXml from '../../../utils/escapeXml.js';
import stableSortByName from '../../../utils/stableSortByName.js';

export default function emitVariables(vars = []) {

    const out = [];

    const sortedVars = stableSortByName(vars);

    for (const v of sortedVars) {

        out.push(`  <variables>`);
        out.push(`    <name>${escapeXml(v.name)}</name>`);
        out.push(`    <dataType>${escapeXml(v.type)}</dataType>`);
        out.push(`    <isCollection>${v.isCollection ? 'true' : 'false'}</isCollection>`);
        out.push(`    <isInput>${v.isInput ? 'true' : 'false'}</isInput>`);
        out.push(`    <isOutput>${v.isOutput ? 'true' : 'false'}</isOutput>`);
        out.push(`  </variables>`);
    }

    return out;
}
