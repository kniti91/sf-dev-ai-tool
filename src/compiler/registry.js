class CompilerRegistry {

    constructor() {
        this.compilers = new Map();
    }

    register(kind, compiler) {
        if (this.compilers.has(kind)) {
            throw new Error(`Compiler already registered for ${kind}`);
        }

        this.compilers.set(kind, compiler);
    }

    get(kind) {
        const compiler = this.compilers.get(kind);

        if (!compiler) {
            throw new Error(`No compiler found for module kind: ${kind}`);
        }

        return compiler;
    }
}

const registry = new CompilerRegistry();

export default registry;
