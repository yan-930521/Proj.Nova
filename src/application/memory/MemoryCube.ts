// cube is for a user
// can have trees

import { ComponentContainer } from '../../ComponentContainer';
import { JsonCubeLoader } from '../../frameworks/json/JsonCubeLoader';
import { Vectra } from '../../frameworks/vectra/vectra';
import { BaseComponent } from '../../libs/base/BaseComponent';
import { getUid } from '../../libs/utils/string';
import { Session } from '../SessionContext';
import { MemorySystemLogger } from './base/Memory';
import { MemoryNode } from './tree/MemoryNode';
import { GraphNodeMetadata, MemoryTree, MemoryTreeData, NODES_PATH } from './tree/MemoryTree';

export interface MemoryCubeData {
    id: string
    memoryTree: MemoryTreeData
}

export class MemoryCube extends BaseComponent {
    public id: string;

    // @ts-ignore
    public memoryTree: MemoryTree;
    public canOptimize: boolean = false;
    public optimizeTimer?: NodeJS.Timeout;

    constructor(id?: string) {
        super({
            name: "MemoryCube"
        });
        this.id = id ?? this.createId();
    }

    /**
     * 建立ID
     * @param baseId 
     * @returns 
     */
    createId(baseId: string = getUid()) {
        return "MemoryCube-" + baseId;
    }

    protected async initLogic(): Promise<void> {
        this.memoryTree = new MemoryTree();
        this.optimizeTimer = setInterval(() => {
            this.treeOptimizeLoop();
        }, ComponentContainer.getConfig().optimizationTime);

        await this.loadCube(ComponentContainer.getConfig().defaultCharacter);
    }

    async treeOptimizeLoop() {
        await this.memoryTree?.reorganizer.treeOptimize("LongTermMemory", 5, 3, 10);
        await this.memoryTree?.reorganizer.treeOptimize("UserMemory", 5, 3, 10);
        await this.saveCube();
    }

    async search(query: string, topk: number = 3, session: Session) {
        if (ComponentContainer.getConfig().isMultipleChat) return (await this.memoryTree?.search(query, topk, null)) ?? [];
        return (await this.memoryTree?.search(query, topk, session)) ?? [];
    }

    getMemory(session: Session) {
        if (ComponentContainer.getConfig().isMultipleChat) return this.memoryTree?.nodeManager.toString(null, null, true, 5);
        return this.memoryTree?.nodeManager.toString(null, session, true, 5);
    }

    getWorkingMemory(session: Session) {
        if (ComponentContainer.getConfig().isMultipleChat) return this.memoryTree.getWorkingMemory(null);
        return this.memoryTree.getWorkingMemory(session);
    }

    toString(nodes: MemoryNode[] | null, session: Session, topK?: number) {
        if (ComponentContainer.getConfig().isMultipleChat) {
            let result = this.memoryTree?.nodeManager.toString(nodes, null, false, topK);
            MemorySystemLogger.debug("Memory Tree:\n" + result);
            return result;
        } else {
            let result = this.memoryTree?.nodeManager.toString(nodes, session, false, topK);
            MemorySystemLogger.debug("Memory Tree:\n" + result);
            return result;
        }
    }

    toDetailString(nodes: MemoryNode[] | null, session: Session, topK?: number) {
        if (ComponentContainer.getConfig().isMultipleChat) {
            let result = this.memoryTree?.nodeManager.toString(nodes, null, true, topK);
            MemorySystemLogger.debug("Memory Tree:\n" + result);
            return result;
        }
        else {
            let result = this.memoryTree?.nodeManager.toString(nodes, session, true, topK);
            MemorySystemLogger.debug("Memory Tree:\n" + result);
            return result;
        }
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

    async recreateVectorDatabase() {
        for (const node of this.memoryTree.nodeManager.getAllNodes().values()) {
            await Vectra.getInstance().upsertItem<GraphNodeMetadata>({
                id: NODES_PATH.replace("{node_id}", node.id),
                vector: node.metadata.embedding,
                metadata: this.memoryTree.nodeManager.createGraphNodeMetadata(node)
            });
        }
    }

    destroy() {
        if (this.optimizeTimer) {
            clearInterval(this.optimizeTimer);
        }
    }
}