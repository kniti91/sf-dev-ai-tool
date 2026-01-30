import escapeXml from '../../../utils/escapeXml.js';

export default function emitStartRecord(start = {}) {

    if (!start.objectApiName || !start.triggerType) {
        throw new Error("Record flow requires objectApiName and triggerType");
    }

    const out = [];
    out.push(`  <start>`);
    out.push(`    <object>${escapeXml(start.objectApiName)}</object>`);
    out.push(`    <recordTriggerType>${escapeXml(start.triggerType)}</recordTriggerType>`);

    if (start.connectorTo) {
        out.push(`    <connector>`);
        out.push(`      <targetReference>${escapeXml(start.connectorTo)}</targetReference>`);
        out.push(`    </connector>`);
    }

    if (start.runAsUserId) {
        out.push(`    <runAsUserId>${escapeXml(start.runAsUserId)}</runAsUserId>`);
    }

    if (start.entryCriteria?.length) {
        out.push(`    <filterLogic>1</filterLogic>`);
        for (const c of start.entryCriteria) {
            out.push(`    <filters>`);
            out.push(`      <field>${escapeXml(c.field)}</field>`);
            out.push(`      <operator>${escapeXml(c.operator)}</operator>`);
            out.push(`      <value>${escapeXml(String(c.value))}</value>`);
            out.push(`    </filters>`);
        }
    }

    out.push(`  </start>`);
    return out;
}
