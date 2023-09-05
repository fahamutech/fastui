import child_process from "child_process";
import {expect} from "chai";
import {readFile} from "node:fs/promises";
import {join, resolve, sep as pathSep} from "node:path"
import {readSpecs, specToJSON} from "../src/services/specs.mjs";
import {composeComponent} from "../src/services/component.mjs";

const specFile = " import React from 'react'; import {getColor} from '../test/blueprints/logics/test_comp.mjs'; export function TestComp({view,loopElement,loopIndex}){ const component = React.useMemo(()=>({states:{},inputs:{\"view\":view,\"loopElement\":loopElement,\"loopIndex\":loopIndex}}),[view,loopElement,loopIndex]); const style = React.useMemo(()=>({\"height\":54,\"backgroundColor\":\"blue\",\"color\":getColor({component,args: []})}),[view,loopElement,loopIndex]); return( <div style={{\"display\":\"flex\",\"flexDirection\":\"column\"}}> <div style={style} ></div> {view} </div> ); } ";
const logicFile = `
/**
* @param data {
* {component: {states: *,inputs: *}, args: Array<*>}
* }
*/
export function getColor(data) {
    // TODO: Implement the logic
    throw new Error('Method getColor not implemented');
}`;

describe('Specs', function () {
    before(()=>{
        console.log(process.cwd(),'++++++CWD+++++')
    })
    describe('list', function () {
        it('should list specs of the selected folder', async function () {
            const resp = await readSpecs(`./test/blueprints`);
            expect(resp).includes(join('test','blueprints','test_comp.yml'));
        });
        it('should list spec of the selected folder', async function () {
            const resp = await readSpecs(`./test/blueprints/test_comp.yml`);
            expect(resp).includes(join('test','blueprints','test_comp.yml'));
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
});