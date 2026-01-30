function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function getFieldFilePath(objectApiName, fieldApiName) {
  // SFDX-style path
  return `objects/${objectApiName}/fields/${fieldApiName}.field-meta.xml`;
}

export function generateCustomFieldXML(intent) {
  const f = intent.field;

  const required = f.required === true ? 'true' : 'false';

  let extra = '';

  if (f.type === 'Text') {
    extra += `  <length>${Number(f.length)}</length>\n`;
  }

  if (f.type === 'Number') {
    extra += `  <precision>${Number(f.precision)}</precision>\n`;
    extra += `  <scale>${Number(f.scale ?? 0)}</scale>\n`;
  }

  if (f.type === 'Picklist') {
    // Minimal picklist XML
    const valuesXml = (f.values || []).map(v => `
      <picklistValues>
        <fullName>${xmlEscape(v)}</fullName>
        <default>false</default>
        <label>${xmlEscape(v)}</label>
        <active>true</active>
      </picklistValues>`).join('');

    extra += `  <valueSet>\n`;
    extra += `    <valueSetDefinition>\n`;
    extra += valuesXml + '\n';
    extra += `      <sorted>false</sorted>\n`;
    extra += `    </valueSetDefinition>\n`;
    extra += `  </valueSet>\n`;
  }

  // Checkbox defaults, if you want:
  if (f.type === 'Checkbox') {
    extra += `  <defaultValue>${f.defaultValue === true ? 'true' : 'false'}</defaultValue>\n`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
  <fullName>${xmlEscape(f.apiName)}</fullName>
  <label>${xmlEscape(f.label)}</label>
  <type>${xmlEscape(f.type)}</type>
${extra}  <required>${required}</required>
</CustomField>
`;
}
