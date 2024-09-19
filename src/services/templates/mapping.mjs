import {ReactJSTemplate} from "./reactjs/index.mjs";
import {FlutterTemplate} from "./flutter/index.mjs";


const reactJsTemplate = new ReactJSTemplate();
const flutterTemplate = new FlutterTemplate();

export const TEMPLATE_MAPPING = {
    statesPresentation: {reactjs: reactJsTemplate.statePresentation, flutter: flutterTemplate.statePresentation},
    sideEffectsPresentation: {
        reactjs: reactJsTemplate.sideEffectsPresentation,
        flutter: flutterTemplate.sideEffectsPresentation
    },
    inputsPresentation: {reactjs: reactJsTemplate.inputsPresentation, flutter: flutterTemplate.inputsPresentation},
}