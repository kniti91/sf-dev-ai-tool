class FlowEmitterRegistry {

    constructor() {
        this.emitters = new Map();
    }

    register(processType, emitter) {

        if (this.emitters.has(processType)) {
            throw new Error(
                `Flow emitter already registered for ${processType}`
            );
        }

        this.emitters.set(processType, emitter);
    }

    get(processType) {

        const emitter = this.emitters.get(processType);

        if (!emitter) {
            throw new Error(
                `No Flow emitter registered for processType: ${processType}`
            );
        }

        return emitter;
    }
}

export default new FlowEmitterRegistry();
