const compileProgram = require('../src/compiler/compile');

require('../src/emitters/flow');

test("screen flow compiles deterministically", async () => {

    const programIR = require('../scripts/testProgram');

    const result = await compileProgram(programIR);

    expect(result.diagnostics).toEqual([]);

    const xml = result.artifacts[0].content;

    expect(xml).toMatchSnapshot();
});
