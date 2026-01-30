import escapeXml from '../../../utils/escapeXml.js';

export default function emitStartScreen(start = {}) {

    if (!start.connectorTo) {
        throw new Error("Screen flow must connect to a screen");
    }

    return [
        `  <start>`,
        `    <connector>`,
        `      <targetReference>${escapeXml(start.connectorTo)}</targetReference>`,
        `    </connector>`,
        `  </start>`
    ];
}
