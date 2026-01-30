// Minimal IR needed for record-triggered flow (V1)

export const FLOW_PROCESS_TYPE = {
  RECORD_TRIGGERED: 'RecordTriggeredFlow',
  AUTO_LAUNCHED: 'AutoLaunchedFlow',
};

export const TRIGGER_TYPE = {
  CREATED: 'Created',
  UPDATED: 'Updated',
  CREATED_OR_UPDATED: 'CreatedOrUpdated',
};
