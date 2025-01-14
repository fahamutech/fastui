import axios from "axios";

/**
 *
 * @param token
 * @param figFile
 * @return {Promise<any>}
 */
export async function fetchFigmaFile({token, figFile}) {
    try {
        const {data} = await axios.get(`https://api.figma.com/v1/files/${figFile}`, {
            headers: {
                'X-Figma-Token': token
            }
        });
        return data;
    } catch (e) {
        console.log(e?.response?.data ?? e?.data ?? e?.message ?? e?.toString() ?? 'Fail to retrieve figma file');
        process.exit(1);
    }
}