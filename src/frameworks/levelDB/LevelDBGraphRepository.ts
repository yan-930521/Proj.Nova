import { AbstractSublevel } from 'abstract-level';
import { Level } from 'level';

import { MemoryEdge } from '../../application/memory/MemoryEdge';
import { MemoryNode } from '../../application/memory/MemoryNode';
import { GraphRepository } from '../../domain/repositories/GraphRepository';
import { LevelDB } from './LevelDB';

export class LevelDBGraphRepository implements GraphRepository {
	private graph: AbstractSublevel<Level<string, string>, string | any, string, string>

	private static instance: LevelDBGraphRepository;

	constructor() {
		this.graph = LevelDB.getInstance().sublevel<string, string>("graph", {
			valueEncoding: "utf8"
		});
	}

	static getInstance(): LevelDBGraphRepository {
		if (!LevelDBGraphRepository.instance) {
			LevelDBGraphRepository.instance = new LevelDBGraphRepository();
		}
		return LevelDBGraphRepository.instance;
	}

	async save(graph: {
		nodes: Record<string, MemoryNode>;
		edges: Record<string, MemoryEdge[]>;
	}): Promise<boolean> {
		try {
			await this.graph.put("graph", JSON.stringify(graph, null, 2))
			return true;
		} catch (err) {
		}
		return false;
	}

	async load(): Promise<{
		nodes: Record<string, MemoryNode>;
		edges: Record<string, MemoryEdge[]>;
	}> {
		try {
			let graph = await this.graph.get("graph");
			let graphJson = graph ? JSON.parse(graph) : {
				nodes: {},
				edges: {}
			}
			return graphJson;
		} catch (err) {
		}
		return {
			nodes: {},
			edges: {}
		};
	}
}