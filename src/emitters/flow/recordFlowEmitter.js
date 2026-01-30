import emitStartRecord from './primitives/emitStartRecord.js';
import escapeXml from '../../utils/escapeXml.js';

class RecordFlowEmitter {

    emit(flow) {

        const parts = [];

        parts.push(`<?xml version="1.0" encoding="UTF-8"?>`);
        parts.push(`<Flow xmlns="http://soap.sforce.com/2006/04/metadata">`);

        parts.push(`<apiVersion>${flow.apiVersion}</apiVersion>`);
        parts.push(`<label>${escapeXml(flow.label)}</label>`);
        parts.push(`<processType>RecordTriggeredFlow</processType>`);
        parts.push(`<status>Draft</status>`);

        parts.push(...emitStartRecord(flow.start));

        parts.push(`</Flow>`);

        return parts.join('\n');
    }
}

export default new RecordFlowEmitter();
