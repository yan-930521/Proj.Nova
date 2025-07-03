import { nanoid } from 'nanoid';
import * as OpenCC from 'opencc-js';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * 生成UID
 * @returns 
 */
export const getUid = () => {
    return  Date.now().toString() + "-" + nanoid(16);
}

/**
 * 
 * @param fileURL file url of that module
 * @returns 
 */
export const getDir = (fileURL: string) => {
    return path.dirname(fileURLToPath(fileURL));
}

/**
 * 取得現在時間
 * @returns
 */
export const getTime = () => {
    return new Date().toLocaleString();
}


export const tw2s = OpenCC.Converter({ from: 'tw', to: 'cn' });
export const s2tw = OpenCC.Converter({ from: 'cn', to: 'tw' });
