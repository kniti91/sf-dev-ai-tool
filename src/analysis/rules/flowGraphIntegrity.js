module.exports = {

    name: 'FLOW_GRAPH_INTEGRITY',

    check(programIR){

        const diagnostics = [];

        for(const m of programIR.modules){

            if(m.kind !== 'flow') continue;

            const nodes = new Set([
                ...(m.screens || []).map(s=>s.name),
                ...(m.elements || []).map(e=>e.name)
            ]);

            for(const s of m.screens || []){

                if(s.connectorTo && !nodes.has(s.connectorTo)){

                    diagnostics.push({
                        severity:'error',
                        code:'BROKEN_FLOW_EDGE',
                        message:`Screen ${s.name} points to missing node ${s.connectorTo}`
                    });
                }
            }
        }

        return diagnostics;
    }
};
