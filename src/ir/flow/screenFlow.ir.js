export function createScreenFlowIR({
    name,
    label,
    apiVersion,
    variables = [],
    screens = [],
    elements = []
}) {

    if (!screens.length) {
        throw new Error("ScreenFlow requires at least one screen");
    }

    return {
        kind: 'flow',
        flowType: 'screen',
        processType: 'Flow', // Salesforce metadata value for Screen Flow
        name,
        label,
        apiVersion,
        variables,
        screens,
        elements,
        start: {
            connectorTo: screens[0].name
        }
    };
}
