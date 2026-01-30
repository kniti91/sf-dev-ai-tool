import Artifact from '../../compiler/artifact.js';
import emitClass from './emitClass.js';
import emitTrigger from './emitTrigger.js';

class ApexAutomationCompiler {

    async compile(module) {

        const artifacts = [];

        // stable ordering
        const components = [...module.components]
            .sort((a,b) => a.name.localeCompare(b.name));

        for (const component of components) {

            const classSource = emitClass(component);

            artifacts.push(
                new Artifact({
                    type: 'apex',
                    path: `force-app/main/default/classes/${component.name}.cls`,
                    content: classSource
                })
            );
        }

        for (const entry of module.entrypoints) {

            if (entry.type === 'triggerHandler') {

                const triggerSource = emitTrigger(entry);

                artifacts.push(
                    new Artifact({
                        type: 'apex',
                        path: `force-app/main/default/triggers/${entry.name}.trigger`,
                        content: triggerSource
                    })
                );
            }
        }

        return artifacts;
    }
}

export default ApexAutomationCompiler;
