import {loadEnvFile} from "../services/generator/helper.mjs";

await loadEnvFile();

export const getTemplateSelected = () =>
    /(reactjs|flutter|react-native)/ig.test(process.env.TEMPLATE)
    ? `${process.env.TEMPLATE}`.trim().toLowerCase()
    : 'reactjs';

export const isFlutterTemplate = () => getTemplateSelected() === 'flutter';