import flowRegistry from './flowEmitterRegistry.js';
import Artifact from '../../compiler/artifact.js';

class FlowCompiler {

    async compile(module) {

        const emitter = flowRegistry.get(module.processType);

        const xml = emitter.emit(module);

        return [
            new Artifact({
                type: 'xml',
                path: `force-app/main/default/flows/${module.name}.flow-meta.xml`,
                content: xml
            })
        ];
    }
}

export default FlowCompiler;
