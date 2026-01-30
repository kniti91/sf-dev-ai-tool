import escapeXml from '../../../utils/escapeXml.js';
import stableSortByName from '../../../utils/stableSortByName.js';

const DEFAULT_AUTO_DISPLAY = {
  name: 'AutoDisplay',
  type: 'DisplayText',
  text: 'Continue',
};

export default function emitScreen(screen) {

    const out = [];

    out.push(`  <screens>`);
    out.push(`    <name>${escapeXml(screen.name)}</name>`);
    out.push(`    <label>${escapeXml(screen.label)}</label>`);
    out.push('');

    const fields = Array.isArray(screen.fields)
    ? stableSortByName(screen.fields)
    : [];
    if (fields.length) {
        for (const field of fields) {
            out.push(...emitScreenField(field));
            out.push('');
        }
    } else {
        out.push(`    <!-- Auto-injected safety component -->`);
        out.push(...emitScreenField({
            ...DEFAULT_AUTO_DISPLAY,
            text: screen.autoDisplayText ?? DEFAULT_AUTO_DISPLAY.text,
        }));
        out.push('');
    }

    if (screen.connectorTo) {
        out.push(`    <connector>`);
        out.push(`      <targetReference>${escapeXml(screen.connectorTo)}</targetReference>`);
        out.push(`    </connector>`);
        out.push('');
    }

    out.push(`  </screens>`);

    return out;
}

function emitScreenField(field) {
    const out = [];
    out.push(`    <fields>`);
    out.push(`      <name>${escapeXml(field.name)}</name>`);
    out.push(`      <fieldType>${escapeXml(field.type)}</fieldType>`);

    if (field.label) {
      out.push(`      <label>${escapeXml(field.label)}</label>`);
    }

    if (field.text != null && field.text !== '') {
      out.push(`      <text><![CDATA[${field.text}]]></text>`);
    }

    if (field.required) {
      out.push(`      <isRequired>true</isRequired>`);
    }

    const shouldStoreOutput =
      field.storeOutputAutomatically ??
      field.type === 'InputField';
    if (shouldStoreOutput) {
      out.push(`      <storeOutputAutomatically>true</storeOutputAutomatically>`);
    }

    out.push(`    </fields>`);
    return out;
}
