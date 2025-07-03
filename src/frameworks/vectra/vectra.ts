import { join } from 'path';
import { LocalIndex } from 'vectra';

export const PAYLOAD_KEY = "content";
export const PATH_KEY = "path";
export const TIMESTAMP_KEY = "timestamp";
export const PATCH_PATH = "user/{user_id}/patches/{memory_schema}";
export const INSERT_PATH = 'user/{user_id}/inserts/{memory_schema}/{memory_id}';
export const MEMORY_PATH = 'memories/{memory_id}'

export class Vectra {
    private static instance: Vectra;

    private index: LocalIndex

    constructor(VECTOR_DB_DIR: string, VECTOR_DB_NAME: string) {
        this.index = new LocalIndex(join(VECTOR_DB_DIR, VECTOR_DB_NAME));
    }

    // 只需要呼叫一次
    static initialize(VECTOR_DB_DIR: string, VECTOR_DB_NAME: string): void {
        if (!Vectra.instance) {
            Vectra.instance = new Vectra(VECTOR_DB_DIR, VECTOR_DB_NAME);
        }
    }

    static getInstance(): LocalIndex {
        if (!Vectra.instance) {
            throw new Error('Vectra has not been initialized.');

        }
        return Vectra.instance.index;
    }

}

export const checkVectra = async () => {
    if (!(await Vectra.getInstance().isIndexCreated())) await Vectra.getInstance().createIndex();
}