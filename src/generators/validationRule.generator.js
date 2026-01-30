function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function generateValidationRuleXML(intent) {
  const location =
    intent.errorLocation === 'Field'
      ? `<errorDisplayField>${intent.errorField}</errorDisplayField>`
      : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<ValidationRule xmlns="http://soap.sforce.com/2006/04/metadata">
  <fullName>${xmlEscape(intent.ruleName)}</fullName>
  <active>${intent.active !== false}</active>
  <errorConditionFormula>${xmlEscape(intent.formula)}</errorConditionFormula>
  <errorMessage>${xmlEscape(intent.errorMessage)}</errorMessage>
  ${location}
</ValidationRule>
`;
}
