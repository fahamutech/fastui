import {expect} from "chai";
import {readFile,readdir} from "node:fs/promises";
import {join, resolve} from "node:path"
import {readSpecs, specToJSON} from "../src/services/specs.mjs";
import {composeComponent} from "../src/services/component.mjs";
import {ensureBlueprintFolderExist, ensureWatchFileExist} from "../src/services/helper.mjs";
import {specFile,logicFile,watchFileContent} from './data.mjs'

describe('Specs', function () {
    before(() => {
        // console.log(process.cwd(),'++++++CWD+++++')
    })
    describe('list', function () {
        it('should list specs of the selected folder', async function () {
            const resp = await readSpecs(`./test/blueprints`);
            expect(resp).includes(join('test', 'blueprints', 'test_comp.yml'));
        });
        it('should list spec of the selected folder', async function () {
            const resp = await readSpecs(`./test/blueprints/test_comp.yml`);
            expect(resp).includes(join('test', 'blueprints', 'test_comp.yml'));
        });
    });

    describe('build', function () {
        before(async () => {
            const specsPath = await readSpecs('./test/blueprints');
            for (const specPath of specsPath) {
                const data = await specToJSON(specPath);
                const {component, components, condition, loop} = JSON.parse(JSON.stringify(data ?? {}));
                const paths = {path: specPath, projectPath: process.cwd()};
                await composeComponent({data: components ?? component, ...paths});
            }
        })
        it('should build the specs', async function () {
            const file = await readFile(resolve('./test/test_comp.mjs'));
            expect(file.toString()).eql(specFile);
        });
        it('should write the logic file', async function () {
            const file = await readFile(resolve('./test/blueprints/logics/test_comp.mjs'));
            expect(file.toString().replace(/\s+/ig, ' '))
                .eql(logicFile.replace(/\s+/ig, ' '));
        });
    });
    describe('watch', function () {
        const _fn=async ()=>{
            await ensureWatchFileExist();
            const file = await readFile(resolve(join('watch.mjs')));
            expect(file.toString().replace(/\s+/ig, ' '))
                .eql(watchFileContent.replace(/\s+/ig, ' '));
        }
        it('should create a watch file', async function () {
            await _fn();
        });
        it('should replace existing watch file', async function () {
            await _fn();
        });
    });
    describe('init', function () {
        it('should create a blueprint folder', async function () {
            await ensureBlueprintFolderExist();
            await readdir(resolve(join('src','blueprints')));
        });
    });
});