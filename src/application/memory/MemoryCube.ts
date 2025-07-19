// cube is for a user
// can have trees

import { ComponentContainer } from '../../ComponentContainer';
import { JsonCubeLoader } from '../../frameworks/json/JsonCubeLoader';
import { getUid } from '../../libs/utils/string';
import { Session } from '../SessionContext';
import { MemorySystemLogger } from './base/Memory';
import { MemoryTree, MemoryTreeData } from './tree/MemoryTree';

export interface MemoryCubeData {
    id: string
    memoryTree: MemoryTreeData
}

export class MemoryCube {
    public id: string;
    public memoryTree: MemoryTree = new MemoryTree();
    public canOptimize: boolean = false;
    public optimizeTimer?: NodeJS.Timeout;

    constructor(id?: string) {
        this.id = id ?? this.createId();
        this.optimizeTimer = setInterval(() => {
            this.treeOptimizeLoop();
        }, ComponentContainer.getConfig().optimizationTime);
    }

    /**
     * 建立ID
     * @param baseId 
     * @returns 
     */
    createId(baseId: string = getUid()) {
        return "MemoryCube-" + baseId;
    }


    async treeOptimizeLoop() {
        await this.memoryTree?.reorganizer.treeOptimize("LongTermMemory", 5, 3, 10);
        await this.memoryTree?.reorganizer.treeOptimize("UserMemory", 5, 3, 10);
        await this.saveCube();
    }

    async search(query: string, topk: number = 3, session: Session) {
        let result = await this.memoryTree?.search(query, topk, session);
        if (result) MemorySystemLogger.debug("Search Tree:\n" + result);
        return result ?? "";
    }

    getMemory(session: Session) {
        let result = this.memoryTree?.nodeManager.toString(null, session, true, 5);
        return result;
    }

    toString(session: Session) {
        let result = this.memoryTree?.nodeManager.toString(null, session, false);
        MemorySystemLogger.debug("Memory Tree:\n" + result);
        return result
    }

    toDetailString(session: Session) {
        let result = this.memoryTree?.nodeManager.toString(null, session, true);
        MemorySystemLogger.debug("Memory Tree:\n" + result);
        return result
    }

    async saveCube(id: string = this.id): Promise<boolean> {
        try {
            if (id == "") id = this.id;
            let treeData = this.memoryTree?.toJSON();
            if (!treeData) return false;

            let success = await JsonCubeLoader.save(id, {
                id,
                memoryTree: treeData
            });
            if (success) {
                MemorySystemLogger.debug("Save Cube Success: " + id);
                return true;
            } else {
                MemorySystemLogger.debug("Save Cube Failed: " + id);
                return false;
            }
        } catch (err) {
            MemorySystemLogger.debug("Save Cube Failed: " + id);
            return false;
        }
    }

    async loadCube(id: string = this.id) {
        try {
            if (id == "") id = this.id;
            let cubeData = await JsonCubeLoader.load(id);

            this.memoryTree.fromJSON(cubeData.memoryTree);

            this.id = cubeData.id;

            MemorySystemLogger.debug("Load Graph Success: " + id);
            return true;
        } catch (err) {
            MemorySystemLogger.debug("Load Graph Failed: " + id);
            return false;
        }
    }

    destroy() {
        if (this.optimizeTimer) {
            clearInterval(this.optimizeTimer);
        }
    }
}