import createFieldSchema from './createField.schema.json' with { type: 'json' };
import createValidationRuleSchema from './createValidationRule.schema.json' with { type: 'json' };
import createApexClassSchema from './createApexClass.schema.json' with { type: 'json' };

export const INTENT_SCHEMAS = {
  CREATE_FIELD: createFieldSchema,
  CREATE_VALIDATION_RULE: createValidationRuleSchema,
  CREATE_APEX_CLASS : createApexClassSchema
};
