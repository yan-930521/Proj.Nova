import { getUid } from '../../libs/utils/string';

export type NodeType = "passage" | "phrase" | "seed";

export class MemoryNode {
    public dbId: string = "";

    public vectors: {
        name: number[],
        observations: number[]
    } = {
        name: [],
        observations: []
    }

    
    public uid: string;
    public type: NodeType;

    public name: string;

    public observations: string[] = [];

    /**
     *  節點的重要程度
     */
    public weight: number = 0;

    /**
     * 節點創建時間
     */
    public createdAt: number = Date.now();

    /**
     * 節點最後更新時間
     */
    public updatedAt: number = Date.now();

    constructor(uid: string | null, type: NodeType, name: string) {
        this.name = name;
        this.type = type;
        this.uid = uid ?? this.createId();
    }

    /**
     * 建立ID
     * @param baseId 
     * @returns 
     */
    createId(baseId: string = getUid()) {
        return this.type + baseId;
    }


    /**
     * 記憶被訪問
     */
    touch() {
        this.weight += 0.1;
        this.updatedAt = Date.now();
    }
}