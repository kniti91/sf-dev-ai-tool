import emitVariables from './primitives/emitVariables.js';
import emitStartScreen from './primitives/emitStartScreen.js';
import emitScreen from './primitives/emitScreen.js';
import stableSortByName from '../../utils/stableSortByName.js';
import escapeXml from '../../utils/escapeXml.js';

class ScreenFlowEmitter {

    emit(flow) {

        const parts = [];

        parts.push(`<?xml version="1.0" encoding="UTF-8"?>`);
        parts.push(`<Flow xmlns="http://soap.sforce.com/2006/04/metadata">`);

        parts.push(`<apiVersion>${flow.apiVersion}</apiVersion>`);
        parts.push(`<environments>Default</environments>`);
        parts.push(`<label>${escapeXml(flow.label)}</label>`);
        parts.push(
            `<interviewLabel>${escapeXml(flow.label)} {!$Flow.CurrentDateTime}</interviewLabel>`
        );
        parts.push(`<processType>Flow</processType>`);
        parts.push(`<status>Draft</status>`);

        parts.push(...emitVariables(flow.variables));

        parts.push(...emitStartScreen(flow.start));

        const screens = stableSortByName(flow.screens);

        for (const screen of screens) {
            parts.push(...emitScreen(screen));
        }

        parts.push(`</Flow>`);

        return parts.join('\n');
    }
}

export default new ScreenFlowEmitter();
