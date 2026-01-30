import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const compileProgram = (await import('../src/compiler/compile.js')).default;

// IMPORTANT: register compilers
await import('../src/emitters/apex/index.js');
await import('../src/emitters/flow/index.js');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {

    const { default: programIR } = await import('./testProgram.js'); // we will create this next

    const result = await compileProgram(programIR);

    if (result.diagnostics.length) {
        console.log(JSON.stringify(result.diagnostics, null, 2));
        process.exit(1);
    }

    const baseDir = path.join(__dirname, '../compiled');

    for (const artifact of result.artifacts) {

        const filePath = path.join(baseDir, artifact.path);

        fs.mkdirSync(path.dirname(filePath), { recursive: true });

        fs.writeFileSync(filePath, artifact.content);
    }

    console.log("✅ Compilation successful.");
}

run();
