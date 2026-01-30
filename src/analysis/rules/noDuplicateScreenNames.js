export default {

    name: 'NO_DUPLICATE_SCREENS',

    check(programIR){

        const diagnostics = [];

        for(const m of programIR.modules){

            if(m.kind !== 'flow') continue;

            const seen = new Set();

            for(const s of m.screens ?? []){

                if(seen.has(s.name)){
                    diagnostics.push({
                        severity:'error',
                        code:'DUPLICATE_SCREEN',
                        message:`Duplicate screen name: ${s.name}`
                    });
                }

                seen.add(s.name);
            }
        }

        return diagnostics;
    }
};
