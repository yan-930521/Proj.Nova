import { Level } from 'level';
import { join } from 'path';

export class LevelDB {
    private static instance: LevelDB;

    private level: Level<string, any>;

    constructor(DB_DIR: string, DB_NAME: string) {
        this.level = new Level<string, any>(join(DB_DIR, DB_NAME), {
            valueEncoding: 'json'
        });
    }

    // 只需要呼叫一次
    static initialize(DB_DIR: string, DB_NAME: string): void {
        if (!LevelDB.instance) {
            LevelDB.instance = new LevelDB(DB_DIR, DB_NAME);
        }
    }

    static getInstance(): Level {
        if (!LevelDB.instance) {
            throw new Error('LevelDB has not been initialized.');
        }
        return LevelDB.instance.level;
    }

}