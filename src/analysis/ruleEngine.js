import rules from './rules/index.js';

async function run(programIR) {

    const diagnostics = [];

    for (const rule of rules) {

        const result = await rule.check(programIR);

        if (result?.length) {
            diagnostics.push(...result);
        }
    }

    return diagnostics;
}

export default run;
