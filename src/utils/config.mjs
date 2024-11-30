import {loadEnvFile} from "../services/helper.mjs";

await loadEnvFile();

export const getTemplateSelected = () =>
    /(reactjs|flutter)/ig.test(process.env.TEMPLATE)
    ? `${process.env.TEMPLATE}`.trim().toLowerCase()
    : 'reactjs';