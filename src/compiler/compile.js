import registry from './registry.js';
import runStaticAnalysis from '../analysis/ruleEngine.js';

async function compileProgram(programIR) {

    const diagnostics = await runStaticAnalysis(programIR);

    const errors = diagnostics.filter(d => d.severity === 'error');

    if (errors.length) {
        return { artifacts: [], diagnostics };
    }

    const artifacts = [];

    for (const module of programIR.modules) {

        //const compiler = registry.get(module.kind);
        let compiler;

        try {
            compiler = registry.get(module.kind);
        } catch(err){
            return {
                artifacts: [],
                diagnostics: [{
                    severity: 'error',
                    code: 'UNKNOWN_MODULE',
                    message: `No compiler registered for ${module.kind}`
                }]
            };
        }
        const result = await compiler.compile(module, programIR);

        artifacts.push(...result);
    }

    return {
        artifacts,
        diagnostics
    };
}

export default compileProgram;
