import registry from '../../compiler/registry.js';
import ApexAutomationCompiler from './apexAutomation.compiler.js';

registry.register(
    'apex.automation',
    new ApexAutomationCompiler()
);
