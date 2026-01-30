import { getSalesforceConnection } from '../salesforce/auth.js';

export async function describeObject(objectName) {
  const conn = getSalesforceConnection();

  await conn.login(
    process.env.SF_USERNAME,
    process.env.SF_PASSWORD + process.env.SF_SECURITY_TOKEN
  );

  return conn.describe(objectName);
}
