import jsforce from 'jsforce';

export function getOAuth2(overrides = {}) {
  return new jsforce.OAuth2({
    loginUrl: process.env.SF_LOGIN_URL,
    clientId: process.env.SF_CLIENT_ID,
    clientSecret: process.env.SF_CLIENT_SECRET,
    redirectUri: process.env.SF_CALLBACK_URL,
    ...overrides
  });
}

export function getSalesforceConnection(accessToken, instanceUrl) {
  return new jsforce.Connection({
    accessToken,
    instanceUrl
  });
}
