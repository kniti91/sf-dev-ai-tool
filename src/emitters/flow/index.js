import compilerRegistry from '../../compiler/registry.js';
import FlowCompiler from './flow.compiler.js';
import flowEmitterRegistry from './flowEmitterRegistry.js';
import screenEmitter from './screenFlowEmitter.js';
import recordEmitter from './recordFlowEmitter.js';

flowEmitterRegistry.register('Flow', screenEmitter);
flowEmitterRegistry.register('RecordTriggeredFlow', recordEmitter);

compilerRegistry.register('flow', new FlowCompiler());
