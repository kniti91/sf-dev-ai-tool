class Artifact {
    constructor({
        type,
        path,
        content
    }) {
        this.type = type;       // apex | xml | json
        this.path = path;
        this.content = content;
    }
}

export default Artifact;
