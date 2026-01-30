/**
 * Record Flow Module IR (V1)
 * Deterministic + minimal; add fields as you need them.
 */
export function createRecordFlowIR({
  name,
  label,
  apiVersion,
  objectApiName,
  triggerType,
  runAsUserId,     // optional
  entryCriteria,   // optional: array of criteria
  elements,        // required: array
}) {
  return {
    kind: 'flow',
    flowType: 'record',
    name,
    label,
    apiVersion,
    processType: 'RecordTriggeredFlow',
    start: {
      objectApiName,
      triggerType,
      runAsUserId: runAsUserId || null,
      entryCriteria: entryCriteria || [],
      connectorTo: elements?.[0]?.name || null,
    },
    elements: elements || [],
  };
}
