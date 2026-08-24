import axios from 'axios';
import {createHash} from 'node:crypto';
import {mkdir, readFile, rename, rm, stat, writeFile} from 'node:fs/promises';
import {basename, dirname, extname, isAbsolute, join, relative, resolve} from 'node:path';
import * as yaml from 'js-yaml';
import {vectorResourceName} from './naming.mjs';

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']);
const FONT_TYPES = new Set(['font/ttf', 'font/otf', 'font/woff', 'font/woff2', 'application/font-woff', 'application/octet-stream']);
const EXTENSIONS = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg',
    'font/ttf': 'ttf', 'font/otf': 'otf', 'font/woff': 'woff', 'font/woff2': 'woff2', 'application/font-woff': 'woff',
};

const safeName = value => `${value ?? ''}`.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'resource';
const sha256 = value => createHash('sha256').update(value).digest('hex');
const fileExists = async path => { try { return (await stat(path)).isFile(); } catch (_) { return false; } };
const cachedResourceValid = async resource => {
    if (!resource?.file || !(await fileExists(resource.file))) return false;
    if (!resource.sha256) return true;
    try { return sha256(await readFile(resource.file)) === resource.sha256; } catch (_) { return false; }
};
const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms));

function normalizeWeight(value) {
    const weight = Number(value);
    if (!Number.isFinite(weight)) return 400;
    return Math.max(100, Math.min(900, Math.round(weight / 100) * 100));
}

function fontStyle(style = {}) {
    const descriptor = `${style.fontStyle ?? ''} ${style.fontPostScriptName ?? ''}`;
    return style.italic || /italic/i.test(descriptor) ? 'italic' : 'normal';
}

function addUsage(map, key, value, node) {
    const existing = map.get(key) ?? {...value, nodes: []};
    if (!existing.nodes.some(item => item.id === node.id)) existing.nodes.push({id: node.id, name: node.name});
    map.set(key, existing);
}

export function discoverFigmaResources(document) {
    const images = new Map();
    const vectors = new Map();
    const fonts = new Map();
    const visit = node => {
        if (!node || typeof node !== 'object') return;
        for (const paint of [...(Array.isArray(node.fills) ? node.fills : []), ...(Array.isArray(node.strokes) ? node.strokes : [])]) {
            const ref = paint?.imageRef ?? paint?.gifRef;
            if (ref) addUsage(images, ref, {kind: 'image', ref}, node);
        }
        if (node.type === 'VECTOR') {
            const name = vectorResourceName(node);
            addUsage(vectors, `${node.id}`, {kind: 'vector', nodeId: node.id, name, format: 'svg'}, node);
        }
        if (node.type === 'TEXT') {
            const textStyles = [node.style, ...Object.values(node.styleOverrideTable ?? {})].filter(Boolean);
            for (const textStyle of textStyles) {
                if (!textStyle.fontFamily) continue;
                const family = `${textStyle.fontFamily}`;
                const weight = normalizeWeight(textStyle.fontWeight);
                const style = fontStyle(textStyle);
                addUsage(fonts, `${family}|${weight}|${style}`, {kind: 'font', family, weight, style}, node);
            }
        }
        for (const child of node.children ?? []) visit(child);
    };
    visit(document);
    return {images: [...images.values()], vectors: [...vectors.values()], fonts: [...fonts.values()]};
}

async function readJson(path, fallback) {
    try { return JSON.parse(await readFile(path, 'utf8')); } catch (_) { return fallback; }
}

async function retryRequest(callback, {attempts = 4, sleepFn = sleep} = {}) {
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt++) {
        try { return await callback(); }
        catch (error) {
            lastError = error;
            const status = error?.response?.status;
            if (status !== 429 && !(status >= 500 && status < 600)) throw error;
            const rawRetryAfter = error?.response?.headers?.['retry-after'];
            const numericRetryAfter = Number(rawRetryAfter);
            const datedRetryAfter = Date.parse(`${rawRetryAfter ?? ''}`);
            const retryDelay = Number.isFinite(numericRetryAfter)
                ? numericRetryAfter * 1000
                : Number.isFinite(datedRetryAfter) ? Math.max(0, datedRetryAfter - Date.now()) : undefined;
            const delay = retryDelay ?? Math.min(30000, 500 * 2 ** attempt + Math.floor(Math.random() * 250));
            if (delay > 30000 || attempt === attempts - 1) break;
            await sleepFn(delay);
        }
    }
    throw lastError;
}

async function atomicWrite(path, buffer) {
    await mkdir(dirname(path), {recursive: true});
    const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
    try {
        await writeFile(temporary, buffer);
        await rename(temporary, path);
    } catch (error) {
        await rm(temporary, {force: true});
        throw error;
    }
}

function contentTypeOf(response) {
    return `${response?.headers?.['content-type'] ?? ''}`.split(';')[0].trim().toLowerCase();
}

function extensionFor(response, url, allowed) {
    const type = contentTypeOf(response);
    if (type && !allowed.has(type)) throw new Error(`Unexpected content type ${type}`);
    const fromType = EXTENSIONS[type];
    const fromUrl = extname(new URL(url).pathname).slice(1).toLowerCase();
    const normalizedUrl = fromUrl === 'jpeg' ? 'jpg' : fromUrl;
    return fromType ?? normalizedUrl;
}

async function downloadResource({url, destinationBase, allowed, expectedSha, http, sleepFn}) {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== 'https:') throw new Error(`Resource URL must use HTTPS: ${url}`);
    const response = await retryRequest(() => http.get(url, {responseType: 'arraybuffer'}), {sleepFn});
    const buffer = Buffer.from(response?.data ?? []);
    if (!buffer.length) throw new Error('Downloaded resource is empty');
    const declaredLength = Number(response?.headers?.['content-length']);
    if (Number.isFinite(declaredLength) && declaredLength !== buffer.length) {
        throw new Error(`Content length mismatch: expected ${declaredLength}, received ${buffer.length}`);
    }
    const extension = extensionFor(response, url, allowed);
    if (!extension) throw new Error('Unable to determine resource extension');
    const digest = sha256(buffer);
    if (expectedSha && digest.toLowerCase() !== `${expectedSha}`.toLowerCase()) throw new Error('SHA-256 checksum mismatch');
    const file = `${destinationBase}.${extension}`;
    await atomicWrite(file, buffer);
    return {file, sha256: digest, contentType: contentTypeOf(response)};
}

async function mapConcurrent(values, limit, callback) {
    const results = new Array(values.length);
    let cursor = 0;
    const worker = async () => {
        while (cursor < values.length) {
            const index = cursor++;
            results[index] = await callback(values[index], index);
        }
    };
    await Promise.all(Array.from({length: Math.min(limit, values.length)}, worker));
    return results;
}

function chunks(values, size) {
    const output = [];
    for (let index = 0; index < values.length; index += size) output.push(values.slice(index, index + size));
    return output;
}

async function figmaImageFillUrls({token, figFile, http, sleepFn}) {
    const response = await retryRequest(() => http.get(`https://api.figma.com/v1/files/${figFile}/images`, {headers: {'X-Figma-Token': token}}), {sleepFn});
    return response?.data?.meta?.images ?? response?.data?.images ?? {};
}

async function figmaVectorUrls({token, figFile, vectors, http, sleepFn}) {
    const urls = {};
    for (const batch of chunks(vectors, 50)) {
        const ids = batch.map(item => item.nodeId).join(',');
        const response = await retryRequest(() => http.get(`https://api.figma.com/v1/images/${figFile}?format=svg&svg_outline_text=true&ids=${encodeURIComponent(ids)}`, {headers: {'X-Figma-Token': token}}), {sleepFn});
        Object.assign(urls, response?.data?.images ?? {});
    }
    return urls;
}

function variantName(weight, style) {
    if (weight === 400 && style === 'normal') return 'regular';
    if (weight === 400 && style === 'italic') return 'italic';
    return `${weight}${style === 'italic' ? 'italic' : ''}`;
}

async function googleFontFiles({families, apiKey, http, sleepFn}) {
    if (!families.length || !apiKey) return new Map();
    const response = await retryRequest(() => http.get(`https://www.googleapis.com/webfonts/v1/webfonts?key=${encodeURIComponent(apiKey)}&sort=alpha`), {sleepFn});
    const wanted = new Set(families);
    return new Map((response?.data?.items ?? []).filter(item => wanted.has(item.family)).map(item => [item.family, item.files ?? {}]));
}

function configuredFontFile(config, usage, googleFiles) {
    if (!config) return null;
    if (config.source === 'google') {
        const url = googleFiles.get(usage.family)?.[variantName(usage.weight, usage.style)];
        return url ? {url: `${url}`.replace(/^http:/i, 'https:'), weight: usage.weight, style: usage.style} : null;
    }
    return (config.files ?? []).find(file => {
        const exact = normalizeWeight(file.weight) === usage.weight && `${file.style ?? 'normal'}` === usage.style;
        const range = Array.isArray(file.weightRange) && usage.weight >= Number(file.weightRange[0]) && usage.weight <= Number(file.weightRange[1]);
        return (exact || range) && (file.path || file.url);
    }) ?? null;
}

async function resolveFonts({fonts, config, cacheRoot, projectPath, http, sleepFn, unresolved, previousResources, fresh}) {
    const googleFamilySet = new Set();
    for (const font of fonts) {
        if (config[font.family]?.source !== 'google') continue;
        const previous = previousResources?.[`font:${font.family}|${font.weight}|${font.style}`];
        if (fresh || !(await cachedResourceValid(previous))) googleFamilySet.add(font.family);
    }
    const googleFamilies = [...googleFamilySet];
    let googleFiles = new Map();
    try { googleFiles = await googleFontFiles({families: googleFamilies, apiKey: process.env.GOOGLE_FONTS_API_KEY, http, sleepFn}); }
    catch (error) { unresolved.push({kind: 'google-fonts', families: googleFamilies, reason: error.message}); }
    const resolved = await mapConcurrent(fonts, 4, async usage => {
        const resourceKey = `font:${usage.family}|${usage.weight}|${usage.style}`;
        const previous = previousResources?.[resourceKey];
        const configured = config[usage.family];
        if (!fresh && configured?.source === 'google' && await cachedResourceValid(previous)) {
            return {...usage, file: previous.file, sha256: previous.sha256, reconciliation: 'cached'};
        }
        const source = configuredFontFile(config[usage.family], usage, googleFiles);
        if (!source) {
            if (configured?.source === 'google' && await cachedResourceValid(previous)) {
                unresolved.push({...usage, reason: 'Google Fonts refresh failed; retained the verified cached variant'});
                return {...usage, file: previous.file, sha256: previous.sha256, reconciliation: 'cached'};
            }
            unresolved.push({...usage, reason: config[usage.family]?.source === 'google' && !process.env.GOOGLE_FONTS_API_KEY ? 'GOOGLE_FONTS_API_KEY is not set' : 'No exact configured font variant'});
            return null;
        }
        try {
            let buffer;
            let extension;
            let digest;
            if (source.path) {
                const local = resolve(projectPath, source.path);
                buffer = await readFile(local);
                extension = extname(local).slice(1).toLowerCase();
                digest = sha256(buffer);
                if (source.sha256 && digest.toLowerCase() !== `${source.sha256}`.toLowerCase()) throw new Error('SHA-256 checksum mismatch');
            } else {
                if (!fresh && await cachedResourceValid(previous)) {
                    return {...usage, file: previous.file, sha256: previous.sha256, reconciliation: 'cached'};
                }
                const downloaded = await downloadResource({
                    url: source.url,
                    destinationBase: join(cacheRoot, 'fonts', `${safeName(usage.family)}-${usage.weight}-${usage.style}`),
                    allowed: FONT_TYPES,
                    expectedSha: source.sha256,
                    http,
                    sleepFn,
                });
                return {
                    ...usage,
                    file: downloaded.file,
                    sha256: downloaded.sha256,
                    reconciliation: previous?.sha256 && previous.sha256 !== downloaded.sha256 ? 'updated' : 'downloaded',
                };
            }
            if (!['ttf', 'otf', 'woff', 'woff2'].includes(extension)) throw new Error(`Unsupported font extension ${extension}`);
            if (previous?.sha256 === digest && await cachedResourceValid(previous)) {
                return {...usage, file: previous.file, sha256: previous.sha256, reconciliation: 'cached'};
            }
            const file = join(cacheRoot, 'fonts', `${safeName(usage.family)}-${usage.weight}-${usage.style}.${extension}`);
            await atomicWrite(file, buffer);
            return {
                ...usage,
                file,
                sha256: digest,
                reconciliation: previous?.sha256 === digest ? 'cached' : previous?.sha256 ? 'updated' : 'local',
            };
        } catch (error) {
            if (await cachedResourceValid(previous)) {
                unresolved.push({...usage, reason: `${error.message}; retained the verified cached variant`});
                return {...usage, file: previous.file, sha256: previous.sha256, reconciliation: 'cached'};
            }
            unresolved.push({...usage, reason: error.message});
            return null;
        }
    });
    return resolved.filter(Boolean);
}

function fontFormat(extension) {
    return {ttf: 'truetype', otf: 'opentype', woff: 'woff', woff2: 'woff2'}[extension] ?? extension;
}

async function copyIfChanged(source, target) {
    const content = await readFile(source);
    if (await fileExists(target)) {
        const existing = await readFile(target);
        if (sha256(existing) === sha256(content)) return false;
    }
    await atomicWrite(target, content);
    return true;
}

function isManifestOwned(root, candidate) {
    const pathFromRoot = relative(resolve(root), resolve(candidate));
    return pathFromRoot !== '' && !pathFromRoot.startsWith('..') && !isAbsolute(pathFromRoot);
}

function flutterVariantKey(value) {
    return `${value.asset}|${value.weight ?? 400}|${value.style ?? 'normal'}`;
}

async function configureFlutterFonts({fonts, projectPath, previousGenerated = []}) {
    const pubspecPath = join(projectPath, 'pubspec.yaml');
    if (!(await fileExists(pubspecPath))) return [];
    const pubspec = yaml.load(await readFile(pubspecPath, 'utf8')) ?? {};
    const flutter = pubspec.flutter ?? {};
    const priorKeys = new Set(previousGenerated.map(item => `${item.family}|${flutterVariantKey(item)}`));
    const families = (flutter.fonts ?? []).map(family => ({
        ...family,
        fonts: (family.fonts ?? []).filter(font => !priorKeys.has(`${family.family}|${flutterVariantKey(font)}`)),
    })).filter(family => family.fonts.length);
    const generated = [];
    for (const font of fonts) {
        const extension = extname(font.file).slice(1).toLowerCase();
        const filename = `${safeName(font.family)}-${font.weight}-${font.style}.${extension}`;
        const target = join(projectPath, 'assets', 'fonts', 'figma', filename);
        await copyIfChanged(font.file, target);
        const variant = {asset: `assets/fonts/figma/${filename}`, weight: font.weight, ...(font.style === 'italic' ? {style: 'italic'} : {})};
        let family = families.find(item => item.family === font.family);
        if (!family) { family = {family: font.family, fonts: []}; families.push(family); }
        if (!family.fonts.some(item => flutterVariantKey(item) === flutterVariantKey(variant))) family.fonts.push(variant);
        generated.push({family: font.family, ...variant});
    }
    const currentAssets = new Set(generated.map(item => item.asset));
    const ownedRoot = resolve(projectPath, 'assets', 'fonts', 'figma');
    for (const previous of previousGenerated) {
        if (currentAssets.has(previous.asset)) continue;
        const stale = resolve(projectPath, previous.asset);
        if (isManifestOwned(ownedRoot, stale)) await rm(stale, {force: true});
    }
    const nextFlutter = {...flutter};
    if (families.length) nextFlutter.fonts = families;
    else delete nextFlutter.fonts;
    await writeFile(pubspecPath, yaml.dump({...pubspec, flutter: nextFlutter}, {lineWidth: -1}));
    return generated;
}

async function ensureReactFontIntegration(projectPath, css) {
    const publicCss = join(projectPath, 'public', 'fonts', 'figma', 'fastui-fonts.generated.css');
    const htmlPath = join(projectPath, 'index.html');
    const entryCandidates = ['src/main.jsx', 'src/index.jsx', 'src/main.tsx', 'src/index.tsx'];
    const generatedImport = './styles/fastui-fonts.generated.css';
    const htmlExists = await fileExists(htmlPath);
    const initialHtml = htmlExists ? await readFile(htmlPath, 'utf8') : '';
    const usableHtml = /data-fastui-fonts|<html\b|<head\b|<\/head>/i.test(initialHtml);
    if (usableHtml) {
        await atomicWrite(publicCss, Buffer.from(css));
        let html = initialHtml;
        const link = '<link data-fastui-fonts rel="stylesheet" href="/fonts/figma/fastui-fonts.generated.css">';
        if (/data-fastui-fonts/.test(html)) {
            html = html.replace(/<link\b[^>]*data-fastui-fonts[^>]*>/i, link);
            await writeFile(htmlPath, html);
        } else {
            html = /<\/head>/i.test(html)
                ? html.replace(/<\/head>/i, `  ${link}\n</head>`)
                : html.replace(/<html([^>]*)>/i, `<html$1>\n<head>\n  ${link}\n</head>`);
            await writeFile(htmlPath, html);
        }
        for (const candidate of entryCandidates) {
            const entry = join(projectPath, candidate);
            if (!(await fileExists(entry))) continue;
            const source = await readFile(entry, 'utf8');
            const cleaned = source.replace(/^\s*import\s+['"]\.\/styles\/fastui-fonts\.generated\.css['"];?\s*\n?/m, '');
            if (cleaned !== source) await writeFile(entry, cleaned);
        }
        return {mode: 'html', file: publicCss};
    }
    const sourceCss = join(projectPath, 'src', 'styles', 'fastui-fonts.generated.css');
    await atomicWrite(sourceCss, Buffer.from(css));
    for (const candidate of entryCandidates) {
        const entry = join(projectPath, candidate);
        if (!(await fileExists(entry))) continue;
        let source = await readFile(entry, 'utf8');
        if (!source.includes(generatedImport)) await writeFile(entry, `import '${generatedImport}';\n${source}`);
        return {mode: 'module', file: sourceCss};
    }
    return {mode: 'none', file: sourceCss};
}

async function configureReactFonts({fonts, projectPath, previousGenerated = []}) {
    const rules = [];
    const generated = [];
    for (const font of fonts) {
        const extension = extname(font.file).slice(1).toLowerCase();
        const filename = `${safeName(font.family)}-${font.weight}-${font.style}.${extension}`;
        const target = join(projectPath, 'public', 'fonts', 'figma', filename);
        await copyIfChanged(font.file, target);
        rules.push(`@font-face {\n  font-family: ${JSON.stringify(font.family)};\n  src: url("/fonts/figma/${filename}") format("${fontFormat(extension)}");\n  font-weight: ${font.weight};\n  font-style: ${font.style};\n  font-display: swap;\n}`);
        generated.push({family: font.family, weight: font.weight, style: font.style, asset: `/fonts/figma/${filename}`});
    }
    const currentAssets = new Set(generated.map(item => item.asset));
    const ownedRoot = resolve(projectPath, 'public', 'fonts', 'figma');
    for (const previous of previousGenerated) {
        if (currentAssets.has(previous.asset)) continue;
        const stale = resolve(projectPath, 'public', `${previous.asset ?? ''}`.replace(/^\/+/, ''));
        if (isManifestOwned(ownedRoot, stale)) await rm(stale, {force: true});
    }
    const integration = await ensureReactFontIntegration(projectPath, `${rules.join('\n\n')}${rules.length ? '\n' : ''}`);
    return {generated, integration};
}

async function configureTargetAssets({resources, template, projectPath, previousAssets = []}) {
    const targetRoot = join(projectPath, template === 'flutter' ? 'assets/images/figma' : 'public/images/figma');
    const current = [];
    for (const resource of Object.values(resources)) {
        if (!['image', 'vector'].includes(resource.kind) || !resource.file || !(await fileExists(resource.file))) continue;
        const target = join(targetRoot, basename(resource.file));
        await copyIfChanged(resource.file, target);
        current.push(target);
    }
    const currentSet = new Set(current.map(value => resolve(value)));
    for (const old of previousAssets) {
        const absolute = resolve(old);
        if (isManifestOwned(targetRoot, absolute) && !currentSet.has(absolute)) await rm(absolute, {force: true});
    }
    return current;
}

export async function reconcileFigmaResources({document, token, figFile, projectPath = process.cwd(), template = 'reactjs', fresh = false, preserveExisting = false, http = axios, sleepFn = sleep}) {
    const cacheRoot = join(projectPath, '.fastui', 'assets', 'figma');
    const manifestPath = join(cacheRoot, 'manifest.json');
    const reportPath = join(projectPath, '.fastui', 'reports', 'figma-resources.json');
    await mkdir(cacheRoot, {recursive: true});
    const previous = await readJson(manifestPath, {resources: {}, targets: {}});
    const discovered = discoverFigmaResources(document);
    const config = await readJson(join(projectPath, 'fastui.config.json'), {});
    const unresolved = [];
    const resources = {};
    const summary = {discovered: discovered.images.length + discovered.vectors.length + discovered.fonts.length, cached: 0, downloaded: 0, updated: 0, stale: 0, unresolved: 0};

    let fillUrls = {};
    let vectorUrls = {};
    const pendingImages = [];
    for (const item of discovered.images) {
        const old = previous.resources[`image:${item.ref}`];
        if (fresh || !(await cachedResourceValid(old))) pendingImages.push(item);
    }
    const pendingVectors = [];
    for (const item of discovered.vectors) {
        const old = previous.resources[`vector:${item.nodeId}`];
        if (fresh || !(await cachedResourceValid(old))) pendingVectors.push(item);
    }
    try { if (pendingImages.length && token) fillUrls = await figmaImageFillUrls({token, figFile, http, sleepFn}); }
    catch (error) { unresolved.push({kind: 'image-batch', reason: error.message}); }
    try { if (pendingVectors.length && token) vectorUrls = await figmaVectorUrls({token, figFile, vectors: pendingVectors, http, sleepFn}); }
    catch (error) { unresolved.push({kind: 'vector-batch', reason: error.message}); }

    const downloadable = [
        ...discovered.images.map(item => ({...item, key: `image:${item.ref}`, url: fillUrls[item.ref], base: join(cacheRoot, 'images', safeName(item.ref)), allowed: IMAGE_TYPES})),
        ...discovered.vectors.map(item => ({...item, key: `vector:${item.nodeId}`, url: vectorUrls[item.nodeId], base: join(cacheRoot, 'vectors', item.name), allowed: IMAGE_TYPES})),
    ];
    await mapConcurrent(downloadable, 4, async item => {
        const old = previous.resources[item.key];
        if (!fresh && await cachedResourceValid(old)) { resources[item.key] = old; summary.cached++; return; }
        if (!item.url) {
            if (await cachedResourceValid(old)) { resources[item.key] = old; summary.cached++; }
            else unresolved.push({...item, reason: token ? 'Figma did not return a resource URL' : 'FIGMA_TOKEN is unavailable'});
            return;
        }
        try {
            const result = await downloadResource({url: item.url, destinationBase: item.base, allowed: item.allowed, http, sleepFn});
            resources[item.key] = {...item, ...result};
            if (old?.sha256 && old.sha256 !== result.sha256) summary.updated++; else summary.downloaded++;
        } catch (error) {
            if (await cachedResourceValid(old)) { resources[item.key] = old; summary.cached++; }
            unresolved.push({...item, reason: error.message});
        }
    });

    const resolvedFonts = await resolveFonts({
        fonts: discovered.fonts,
        config: config.resources?.fonts ?? {},
        cacheRoot,
        projectPath,
        http,
        sleepFn,
        unresolved,
        previousResources: previous.resources,
        fresh,
    });
    for (const font of resolvedFonts) {
        const {reconciliation, ...resource} = font;
        resources[`font:${font.family}|${font.weight}|${font.style}`] = resource;
        if (reconciliation && reconciliation !== 'local') summary[reconciliation]++;
    }
    // A selected-node refresh only sees part of the Figma file. Keep the
    // resources from every other page so it cannot remove their generated
    // icons, images, or fonts as "stale".
    const reconciledResources = preserveExisting ? {...previous.resources, ...resources} : resources;
    const reconciledFonts = Object.values(reconciledResources).filter(resource => resource.kind === 'font');
    let targets = {
        assets: await configureTargetAssets({resources: reconciledResources, template, projectPath, previousAssets: previous.targets?.assets ?? []}),
    };
    if (template === 'flutter') {
        targets.flutterFonts = await configureFlutterFonts({fonts: reconciledFonts, projectPath, previousGenerated: previous.targets?.flutterFonts ?? []});
    } else {
        const react = await configureReactFonts({fonts: reconciledFonts, projectPath, previousGenerated: previous.targets?.reactFonts ?? []});
        targets.reactFonts = react.generated;
        targets.reactIntegration = react.integration;
    }

    for (const [key, value] of Object.entries(previous.resources ?? {})) {
        if (preserveExisting && !resources[key]) continue;
        if (!value.file) continue;
        if (resources[key]?.file && resolve(resources[key].file) !== resolve(value.file)) {
            const owned = isManifestOwned(cacheRoot, value.file);
            if (owned) { await rm(value.file, {force: true}); summary.stale++; }
            continue;
        }
        if (resources[key]) continue;
        const owned = isManifestOwned(cacheRoot, value.file);
        if (owned) { await rm(value.file, {force: true}); summary.stale++; }
    }
    summary.unresolved = unresolved.length;
    const manifest = {version: 1, figFile, resources: reconciledResources, targets, summary, updatedAt: new Date().toISOString()};
    await mkdir(dirname(manifestPath), {recursive: true});
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    await mkdir(dirname(reportPath), {recursive: true});
    await writeFile(reportPath, JSON.stringify({figFile, summary, discovered, resources: reconciledResources, targets, unresolved}, null, 2));
    if (unresolved.length) console.warn(`WARN : ${unresolved.length} Figma resources unresolved; see ${relative(projectPath, reportPath)}.`);
    return {summary, reportPath, manifestPath, unresolved};
}
