import JSZip from 'jszip';

function getApiVersion() {
  return process.env.SF_API_VERSION || '60.0';
}

function normalizeFieldNames(objectApiName, fieldApiName) {
  if (!objectApiName) {
    throw new Error('Missing objectApiName for deploy.');
  }
  if (!fieldApiName) {
    throw new Error('Missing fieldApiName for deploy.');
  }

  const normalizedField = fieldApiName.includes('.')
    ? fieldApiName.slice(fieldApiName.lastIndexOf('.') + 1)
    : fieldApiName;

  return {
    metadataFullName: `${objectApiName}.${normalizedField}`,
    fieldFileName: normalizedField,
  };
}

function stripXmlWrapper(xml, tagName) {
  const withoutHeader = xml.replace(/<\?xml[^>]*\?>/g, '').trim();
  const openTag = new RegExp(`^<${tagName}[^>]*>`, 'i');
  const closeTag = new RegExp(`</${tagName}>\\s*$`, 'i');
  return withoutHeader.replace(openTag, '').replace(closeTag, '').trim();
}

function buildCustomObjectXml(objectApiName, fieldXml) {
  const fieldContent = stripXmlWrapper(fieldXml, 'CustomField');
  if (!fieldContent) {
    throw new Error('Generated field XML is empty.');
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata">
  <fullName>${objectApiName}</fullName>
  <fields>
${fieldContent}
  </fields>
</CustomObject>`;
}

function buildCustomObjectWithValidationRule(objectApiName, validationRuleXml) {
  const ruleContent = stripXmlWrapper(validationRuleXml, 'ValidationRule');
  if (!ruleContent) {
    throw new Error('Generated validation rule XML is empty.');
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata">
  <fullName>${objectApiName}</fullName>
  <validationRules>
${ruleContent}
  </validationRules>
</CustomObject>`;
}

/**
 * Build a minimal Metadata API zip:
 * - package.xml
 * - objects/<Object>.object (containing the field definition)
 */
export async function deployCustomField(conn, objectApiName, fieldApiName, fieldXml, { checkOnly = true } = {}) {
  const zip = new JSZip();
  const { metadataFullName } = normalizeFieldNames(objectApiName, fieldApiName);
  const objectXml = buildCustomObjectXml(objectApiName, fieldXml);

  // package.xml: include CustomField by fullName Object.Field
  const packageXml = `<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
  <types>
    <members>${metadataFullName}</members>
    <name>CustomField</name>
  </types>
  <version>${getApiVersion()}</version>
</Package>`;

  zip.file('package.xml', packageXml);

  // Metadata path requires object file, not source-format field file.
  zip.file(`objects/${objectApiName}.object`, objectXml);

  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
  const zipBase64 = zipBuffer.toString('base64');

  // Deploy via Metadata API
  const deployOptions = {
    checkOnly,
    rollbackOnError: true,
    singlePackage: true
  };

  const result = await conn.metadata.deploy(zipBase64, deployOptions).complete(true);

  // Normalize response a bit
  return {
    checkOnly,
    status: result.status,
    success: result.success,
    done: result.done,
    details: result.details || null,
    componentFailures: result.details?.componentFailures || null,
    componentSuccesses: result.details?.componentSuccesses || null
  };
}


/**
 * Generic Metadata API deploy
 * Works for CustomField, ValidationRule, ApexClass, etc.
 */
export async function deployCustomMetadata({
  conn,
  object,
  metadataType,
  memberName,
  filePath,
  xml,
  checkOnly = false
}) {
  const zip = new JSZip();

  // package.xml
  const packageXml = `<?xml version="1.0" encoding="UTF-8"?>
    <Package xmlns="http://soap.sforce.com/2006/04/metadata">
    <types>
        <members>${memberName}</members>
        <name>${metadataType}</name>
    </types>
    <version>${getApiVersion()}</version>
    </Package>`;

  zip.file('package.xml', packageXml);
  zip.file(filePath, xml);

  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
  const zipBase64 = zipBuffer.toString('base64');

  const result = await conn.metadata
    .deploy(zipBase64, {
      checkOnly,
      rollbackOnError: true,
      singlePackage: true
    })
    .complete(true);

  return {
    success: result.success,
    status: result.status,
    details: result.details || null
  };
}

export async function deployValidationRule(conn, objectApiName, ruleName, ruleXml, { checkOnly = false } = {}) {
  const zip = new JSZip();
  const objectXml = buildCustomObjectWithValidationRule(objectApiName, ruleXml);

  const packageXml = `<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
  <types>
    <members>${objectApiName}.${ruleName}</members>
    <name>ValidationRule</name>
  </types>
  <version>${getApiVersion()}</version>
</Package>`;

  zip.file('package.xml', packageXml);
  zip.file(`objects/${objectApiName}.object`, objectXml);

  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
  const zipBase64 = zipBuffer.toString('base64');

  const result = await conn.metadata
    .deploy(zipBase64, {
      checkOnly,
      rollbackOnError: true,
      singlePackage: true
    })
    .complete(true);

  return {
    success: result.success,
    status: result.status,
    details: result.details || null
  };
}

function buildApexMetadataXml({ apiVersion = getApiVersion(), status = 'Active' } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ApexClass xmlns="http://soap.sforce.com/2006/04/metadata">
  <apiVersion>${apiVersion}</apiVersion>
  <status>${status}</status>
</ApexClass>`;
}

export async function deployApexClass(
  conn,
  className,
  classBody,
  { checkOnly = false, status = 'Active' } = {}
) {
  if (!className) {
    throw new Error('Missing Apex class name.');
  }
  if (!classBody) {
    throw new Error('Missing Apex class body.');
  }

  const zip = new JSZip();
  const packageXml = `<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
  <types>
    <members>${className}</members>
    <name>ApexClass</name>
  </types>
  <version>${getApiVersion()}</version>
</Package>`;

  zip.file('package.xml', packageXml);
  zip.file(`classes/${className}.cls`, classBody);
  zip.file(`classes/${className}.cls-meta.xml`, buildApexMetadataXml({ status }));

  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
  const zipBase64 = zipBuffer.toString('base64');

  const result = await conn.metadata
    .deploy(zipBase64, {
      checkOnly,
      rollbackOnError: true,
      singlePackage: true
    })
    .complete(true);

  return {
    success: result.success,
    status: result.status,
    details: result.details || null
  };
}
