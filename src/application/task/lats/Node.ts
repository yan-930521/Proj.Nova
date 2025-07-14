import { BaseMessage } from '@langchain/core/messages';

import { ReflectionData } from './Reflection';

export class Node {
    children: Node[] = [];
    value: number = 0;
    visits: number = 0;
    depth: number = 0;

    _isSolved: boolean = false;

    constructor(
        public messages: BaseMessage[],
        public reflection: ReflectionData,
        public parent: Node | null = null,
    ) {
        if (parent) this.depth = parent.depth + 1;
        else this.depth = 1;

        this._isSolved = reflection.found_solution;
        if (this.isSolved)
            this.markTreeAsSolved();
        this.backpropagate(reflection.normalizedScore())

    }

    toString(): string {
        return `<Node value=${this.value}, visits=${this.visits}, solution=${JSON.stringify(this.messages)}, reflection=${JSON.stringify(this.reflection)}>`;
    }


    get isSolved(): boolean {
        return this._isSolved;
    }

    get isTerminal(): boolean {
        return this.children.length === 0;
    }

    /**
     * Check for how far we've rolled out the tree.
     */
    get height(): number {
        return this.children.length > 0
            ? 1 + Math.max(...this.children.map((child) => child.height))
            : 1;
    }

    /**
     * Return the child with the highest value.
     * @returns 
     */
    bestChildScore(): Node | null {
        if (this.children.length === 0) return null;
        return this.children.reduce((best, child) => {
            const childScore = (child.isSolved ? 1 : 0) * child.value;
            const bestScore = (best.isSolved ? 1 : 0) * best.value;
            return childScore > bestScore ? child : best;
        });
    }

    upperConfidenceBound(explorationWeight = 1.0): number {
        if (!this.parent) throw new Error("Cannot obtain UCT from root node");
        if (this.visits === 0) return this.value;

        const averageReward = this.value / this.visits;
        const explorationTerm = Math.sqrt(Math.log(this.parent.visits) / this.visits);
        return averageReward + explorationWeight * explorationTerm;
    }

    backpropagate(reward: number): void {
        let node: Node | null = this;
        while (node) {
            node.visits += 1;
            node.value = (node.value * (node.visits - 1) + reward) / node.visits;
            node = node.parent;
        }
    }

    getMessages(includeReflections = true): BaseMessage[] {
        return includeReflections
            ? [...this.messages, this.reflection.asMessage()]
            : this.messages;
    }

    getTrajectory(includeReflections = true): BaseMessage[] {
        const trajectory: BaseMessage[] = [];
        let node: Node | null = this;
        while (node) {
            const reversed = [...node.getMessages(includeReflections)].reverse();
            trajectory.push(...reversed);
            node = node.parent;
        }
        return trajectory.reverse();
    }

    private getAllChildren(): Node[] {
        const allNodes: Node[] = [];
        const nodes: Node[] = [this];
        while (nodes.length > 0) {
            const node = nodes.shift()!;
            allNodes.push(...node.children);
            nodes.push(...node.children);
        }
        return allNodes;
    }

    getBestSolution(): Node {
        const allNodes = [this, ...this.getAllChildren()];
        return allNodes.reduce((best, node) => {
            const score = (node.isTerminal && node.isSolved ? 1 : 0) * node.value;
            const bestScore = (best.isTerminal && best.isSolved ? 1 : 0) * best.value;
            return score > bestScore ? node : best;
        });
    }

    private markTreeAsSolved(): void {
        let parent = this.parent;
        while (parent) {
            parent._isSolved = true;
            parent = parent.parent;
        }
    }
}