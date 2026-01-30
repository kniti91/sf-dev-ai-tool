import compileProgram from '../src/compiler/compile.js';
import fs from 'fs';
import path from 'path';

// VERY IMPORTANT — boot registries
import '../src/emitters/flow/index.js';

async function test() {

    const programIR = {
        version: "v1",

        modules: [
            {
                kind: "flow",
                processType: "Flow",
                name: "Case_Intake",
                label: "Case Intake",
                apiVersion: "60.0",

                variables: [
                    {
                        name: "subject",
                        type: "String",
                        isOutput: true
                    }
                ],

                start: {
                    connectorTo: "CaptureSubject"
                },

                screens: [
                    {
                        name: "CaptureSubject",
                        label: "Capture Subject",
                        fields: [
                            {
                                name: "subject",
                                type: "InputField",
                                label: "Subject",
                                required: true
                            }
                        ],
                        connectorTo: "Confirm"
                    },
                    {
                        name: "Confirm",
                        label: "Confirm",
                        autoDisplayText: "Case Created Successfully"
                    }
                ]
            }
        ]
    };

    const result = await compileProgram(programIR);

    for (const artifact of result.artifacts) {

        const filePath = path.join("compiled", artifact.path);

        fs.mkdirSync(path.dirname(filePath), { recursive: true });

        fs.writeFileSync(filePath, artifact.content);
    }


}

test();
