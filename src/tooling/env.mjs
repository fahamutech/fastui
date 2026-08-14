import {readFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';

/**
 * Loads a project-root `.env` file (if present) into `process.env`. Silently
 * does nothing when no `.env` file exists.
 */
export async function loadEnvFile() {
    try {
        const filePath = resolve(join('./.env'));
        const data = await readFile(filePath, 'utf-8');
        const lines = data.split('\n');
        lines.forEach(line => {
            if (!line.startsWith('#') && line.trim() !== '') {
                const [key, value] = line.split('=');
                process.env[key.trim()] = value.trim().replace(/^['"]|['"]$/g, '');
            }
        });
    } catch (err) {
    }
}
