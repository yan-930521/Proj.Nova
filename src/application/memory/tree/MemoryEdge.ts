import { getUid } from '../../../libs/utils/string';

export type EdgeType = "PARENT" | "CAUSE" | "CONDITION" | "RELATE_TO" | "CONFLICT" | "INFERS" | "FOLLOWS" | "AGGREGATES";

export class MemoryEdge {
    public id: string;

    public type: EdgeType;

    public from: string;
    public to: string;

    /**
     *  重要程度 / 訪問 / 連接次數
     */
    public weight: number = 0;

    constructor(from: string, to: string, type: EdgeType, id?: string) {
        this.from = from;
        this.to = to;
        this.type = type;
        this.id = id ?? this.createId();
    }

    /**
     * 建立ID
     * @param baseId 
     * @returns 
     */
    createId(baseId: string = getUid()) {
        return "MemoryEdge" + baseId;
    }
}