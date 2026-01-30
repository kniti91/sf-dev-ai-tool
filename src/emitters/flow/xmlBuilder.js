import { escapeXml } from './xmlUtil.js';
import { stableSortByName } from '../../utils/stable.js';
import emitVariables from './primitives/emitVariables.js';
import emitStartScreen from './primitives/emitStartScreen.js';
import emitScreen from './primitives/emitScreen.js';
import emitStartRecord from './primitives/emitStartRecord.js';

const DEFAULT_INTERVIEW_SUFFIX = ' {!$Flow.CurrentDateTime}';
const DEFAULT_AUTO_DISPLAY = {
  name: 'AutoDisplay',
  type: 'DisplayText',
  text: 'Continue',
};

export function buildFlowXml(flow) {
  if (flow.processType === 'Flow') {
    return buildScreenFlow(flow);
  }

  if (flow.processType !== 'RecordTriggeredFlow') {
    throw new Error(`Unsupported flow processType: ${flow.processType}`);
  }
  if (!flow.start?.objectApiName || !flow.start?.triggerType) {
    throw new Error(`RecordTriggeredFlow requires start.objectApiName and start.triggerType`);
  }

  const parts = [];
  parts.push(xmlHeader(flow));
  parts.push('');
  parts.push(...emitStartRecord(flow.start));
  parts.push('');

  const elements = stableSortByName(flow.elements || []);
  for (const el of elements) {
    parts.push(...emitElement(el));
    parts.push('');
  }

  parts.push(`</Flow>`);

  return parts.filter(Boolean).join('\n').replace(/\n{3,}/g, '\n\n');
}

function emitElement(el) {
  switch (el.kind) {
    case 'assignment':
      return emitAssignment(el);
    case 'decision':
      return emitDecision(el);
    case 'action':
      return emitAction(el);
    case 'end':
      // Flow doesn't require explicit end nodes; keep for IR semantics if you want.
      return [];
    default:
      throw new Error(`Unsupported flow element kind: ${el.kind}`);
  }
}

function emitAssignment(el) {
  const out = [];
  out.push(`  <assignments>`);
  out.push(`    <name>${escapeXml(el.name)}</name>`);
  out.push(`    <label>${escapeXml(el.label || el.name)}</label>`);

  for (const a of el.assignments || []) {
    out.push(`    <assignmentItems>`);
    out.push(`      <assignToReference>${escapeXml(a.var)}</assignToReference>`);
    out.push(`      <operator>Assign</operator>`);
    out.push(`      <value>`);
    out.push(`        <stringValue>${escapeXml(String(a.value))}</stringValue>`);
    out.push(`      </value>`);
    out.push(`    </assignmentItems>`);
  }

  if (el.connectorTo) {
    out.push(`    <connector>`);
    out.push(`      <targetReference>${escapeXml(el.connectorTo)}</targetReference>`);
    out.push(`    </connector>`);
  }

  out.push(`  </assignments>`);
  return out;
}

function emitDecision(el) {
  const out = [];
  out.push(`  <decisions>`);
  out.push(`    <name>${escapeXml(el.name)}</name>`);
  out.push(`    <label>${escapeXml(el.label || el.name)}</label>`);

  // rules stable order
  const rules = stableSortByName(el.rules || []);
  for (const r of rules) {
    out.push(`    <rules>`);
    out.push(`      <name>${escapeXml(r.name)}</name>`);
    out.push(`      <conditionLogic>and</conditionLogic>`);
    // V1: accept a single boolean expression string
    out.push(`      <conditions>`);
    out.push(`        <leftValueReference>${escapeXml(r.condition)}</leftValueReference>`);
    out.push(`        <operator>IsTrue</operator>`);
    out.push(`        <rightValue>`);
    out.push(`          <booleanValue>true</booleanValue>`);
    out.push(`        </rightValue>`);
    out.push(`      </conditions>`);

    if (r.connectorTo) {
      out.push(`      <connector>`);
      out.push(`        <targetReference>${escapeXml(r.connectorTo)}</targetReference>`);
      out.push(`      </connector>`);
    }
    out.push(`    </rules>`);
  }

  if (el.defaultConnectorTo) {
    out.push(`    <defaultConnector>`);
    out.push(`      <targetReference>${escapeXml(el.defaultConnectorTo)}</targetReference>`);
    out.push(`    </defaultConnector>`);
  }

  out.push(`  </decisions>`);
  return out;
}

function emitAction(el) {
  const out = [];
  out.push(`  <actionCalls>`);
  out.push(`    <name>${escapeXml(el.name)}</name>`);
  out.push(`    <label>${escapeXml(el.label || el.name)}</label>`);
  // V1: Apex action
  out.push(`    <actionName>${escapeXml(el.apexClass)}</actionName>`);
  out.push(`    <actionType>Apex</actionType>`);

  // inputs
  const keys = Object.keys(el.inputMapping || {}).sort();
  for (const k of keys) {
    out.push(`    <inputParameters>`);
    out.push(`      <name>${escapeXml(k)}</name>`);
    out.push(`      <value>`);
    out.push(`        <elementReference>${escapeXml(el.inputMapping[k])}</elementReference>`);
    out.push(`      </value>`);
    out.push(`    </inputParameters>`);
  }

  if (el.connectorTo) {
    out.push(`    <connector>`);
    out.push(`      <targetReference>${escapeXml(el.connectorTo)}</targetReference>`);
    out.push(`    </connector>`);
  }

  out.push(`  </actionCalls>`);
  return out;
}

function resolveInterviewLabel(flow) {
  if (flow.interviewLabel && String(flow.interviewLabel).trim().length > 0) {
    return flow.interviewLabel;
  }
  return `${flow.label}${DEFAULT_INTERVIEW_SUFFIX}`;
}

function resolveStatus(flow) {
  if (flow.status && String(flow.status).trim().length > 0) {
    return flow.status;
  }
  return flow.processType === 'Flow' ? 'Draft' : 'Active';
}

function xmlHeader(flow) {
  const interviewLabel = resolveInterviewLabel(flow);
  const status = resolveStatus(flow);
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<Flow xmlns="http://soap.sforce.com/2006/04/metadata">`,
    `  <apiVersion>${escapeXml(flow.apiVersion)}</apiVersion>`,
    `  <environments>Default</environments>`,
    `  <label>${escapeXml(flow.label)}</label>`,
    `  <interviewLabel>${escapeXml(interviewLabel)}</interviewLabel>`,
    `  <processType>${escapeXml(flow.processType)}</processType>`,
    `  <status>${escapeXml(status)}</status>`,
  ].join('\n');
}

function buildScreenFlow(flow) {

    const parts = [];

    parts.push(xmlHeader(flow));
    parts.push('');

    const variables = emitVariables(flow.variables);
    if (variables.length) {
        parts.push(...variables);
        parts.push('');
    }

    parts.push(...emitStartScreen(flow.start));
    parts.push('');

    const screens = stableSortByName(flow.screens);
    for (const screen of screens) {
        parts.push(...emitScreen(screen));
        parts.push('');
    }

    const elements = stableSortByName(flow.elements);
    for (const el of elements) {
        parts.push(...emitElement(el));
        parts.push('');
    }

    parts.push(`</Flow>`);

    return parts.filter(Boolean).join('\n').replace(/\n{3,}/g, '\n\n');
}








