export default {
  name: 'RECORD_FLOW_START_REQUIRED',
  check(programIR) {
    const diags = [];
    for (const m of programIR.modules || []) {
      if (m.kind !== 'flow') continue;
      if (m.processType !== 'RecordTriggeredFlow') continue;

      if (!m.start?.objectApiName || !m.start?.triggerType) {
        diags.push({
          severity: 'error',
          code: 'FLOW_START_MISSING',
          message: `RecordTriggeredFlow ${m.name} missing start.objectApiName or start.triggerType`,
          module: m.name,
        });
      }
    }
    return diags;
  }
};
