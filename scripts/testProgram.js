import { createScreenFlowIR } from '../src/ir/flow/screenFlow.ir.js';

export default {

    version: "v1",

    modules: [

        createScreenFlowIR({

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

            screens: [
                {
                    name: "CaptureSubject",
                    label: "Capture Subject",
                    connectorTo:"Confirm",
                    fields: [
                        {
                            name: "subject",
                            type: "InputField",
                            label: "Subject",
                            required: true
                        }
                    ]
                },
                { name:"Confirm", label:"Confirm"}
            ]
        })
    ]
};
