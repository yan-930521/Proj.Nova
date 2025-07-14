import { getUid } from '../../libs/utils/string';

export type EdgeType = "context" | "relation" | "synonym";

export class MemoryEdge {
    public uid: string;

    public type: EdgeType;

    public content: string = "";

    public linkTo: string;

    public vectors: {
        content: number[]
    } = {
            content: []
        }


    /**
     *  重要程度 / 訪問 / 連接次數
     */
    public weight: number = 0;

    constructor(uid: string | null, type: EdgeType, linkTo: string) {
        this.type = type;
        this.uid = uid ?? this.createId();
        this.linkTo = linkTo;
    }

    /**
     * 建立ID
     * @param baseId 
     * @returns 
     */
    createId(baseId: string = getUid()) {
        return this.type + baseId;
    }
}