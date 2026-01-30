module.exports = {

    name: 'SCREEN_FLOW_START_VALIDATION',

    check(programIR){

        const diagnostics = [];

        for(const m of programIR.modules){

            if(m.processType !== 'Flow') continue;

            if(m.start?.objectApiName || m.start?.triggerType){

                diagnostics.push({
                    severity:'error',
                    code:'INVALID_SCREEN_START',
                    message:`ScreenFlow ${m.name} contains record-trigger fields`
                });
            }
        }

        return diagnostics;
    }
};
