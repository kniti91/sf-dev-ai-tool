export default {

    name: 'SCREEN_FLOW_NAV',

    check(programIR) {

        const diagnostics = [];

        for (const m of programIR.modules ?? []) {

            if (m.processType !== 'Flow') continue;

            const nodeNames = new Set([
                ...(Array.isArray(m.screens) ? m.screens : []).map(s => s.name),
                ...(Array.isArray(m.elements) ? m.elements : []).map(e => e.name)
            ]);

            for (const s of m.screens ?? []) {

                if (s.connectorTo && !nodeNames.has(s.connectorTo)) {

                    diagnostics.push({
                        severity: 'error',
                        code: 'INVALID_CONNECTOR',
                        message: `Screen ${s.name} points to missing node ${s.connectorTo}`
                    });
                }
            }
        }

        return diagnostics;
    }
};
